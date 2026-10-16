// The skrape library as a desktop app: the same page as `skrape library`, served from a
// custom `skrape://` protocol that reads the sync database directly, so no server has to run.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use regex::Regex;
use rusqlite::{types::ValueRef, Connection, OpenFlags};
use serde_json::{json, Map, Value};
use tauri::http::{header, Request, Response, StatusCode};
use tauri::{WebviewUrl, WebviewWindowBuilder};
use unicode_normalization::UnicodeNormalization;

/// The page is shared with the CLI's `skrape library`, so both stay identical.
const PAGE: &str = include_str!("../../../src/library/page.html");
/// Largest slice of a video sent per range request; the player asks for more as it plays.
const VIDEO_CHUNK: u64 = 4 * 1024 * 1024;

fn home() -> PathBuf {
    PathBuf::from(std::env::var_os("HOME").unwrap_or_default())
}

/// Same locations the CLI uses (src/auth/session.ts).
fn db_file() -> PathBuf {
    home().join(".skool-skrape").join("skool.db")
}

fn default_out_root() -> PathBuf {
    home().join("skrape")
}

/// Port of slugify in src/store/markdown.ts; video file names depend on matching it exactly.
pub fn slugify(text: &str) -> String {
    let kept: String = text
        .nfkd()
        .filter(|c| c.is_alphabetic() || c.is_numeric() || c.is_whitespace() || *c == '-')
        .collect();
    let lowered = kept.trim().to_lowercase();
    let mut dashed = String::new();
    for c in lowered.chars() {
        if c.is_whitespace() || c == '_' || c == '-' {
            if !dashed.ends_with('-') {
                dashed.push('-');
            }
        } else {
            dashed.push(c);
        }
    }
    let cut: String = dashed.trim_matches('-').chars().take(60).collect();
    let cut = cut.trim_end_matches('-');
    if cut.is_empty() { "untitled".into() } else { cut.into() }
}

fn find_video(dirs: &[PathBuf], course: Option<&str>, position: i64, title: &str) -> Option<PathBuf> {
    for dir in dirs {
        let dir = dir.join("videos").join(slugify(course.unwrap_or("uncategorized")));
        for width in 2..=5 {
            let path = dir.join(format!("{:0width$}-{}.mp4", position, slugify(title), width = width));
            if path.exists() {
                return Some(path);
            }
        }
    }
    None
}

/// Port of snippet in src/library/server.ts.
pub fn snippet(text: &str, query: &str, radius: usize) -> String {
    let stamps = Regex::new(r"\[\d+:\d{2}\] ").unwrap();
    let chars: Vec<char> = text.chars().collect();
    let lower: Vec<char> = chars.iter().map(|c| c.to_lowercase().next().unwrap_or(*c)).collect();
    let needle: Vec<char> = query.chars().map(|c| c.to_lowercase().next().unwrap_or(c)).collect();
    let at = (!needle.is_empty())
        .then(|| lower.windows(needle.len()).position(|w| w == needle.as_slice()))
        .flatten();
    let Some(at) = at else {
        let head: String = chars.iter().take(radius * 2).collect();
        return stamps.replace_all(&head, "").into_owned();
    };
    let start = at.saturating_sub(radius);
    let end = (at + needle.len() + radius).min(chars.len());
    let body: String = chars[start..end].iter().collect();
    format!("{}{}…", if start > 0 { "…" } else { "" }, stamps.replace_all(&body, ""))
}

struct Library {
    db: Option<Connection>,
}

impl Library {
    fn open() -> Self {
        // Read-only, and reopened per request, so a sync running in the terminal is picked up live.
        let db = Connection::open_with_flags(db_file(), OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX).ok();
        Library { db }
    }

    fn rows(&self, sql: &str, params: &[&dyn rusqlite::ToSql]) -> Vec<Map<String, Value>> {
        let Some(db) = &self.db else { return vec![] };
        let Ok(mut stmt) = db.prepare(sql) else { return vec![] };
        let names: Vec<String> = stmt.column_names().iter().map(|n| n.to_string()).collect();
        let Ok(mapped) = stmt.query_map(params, |row| {
            let mut map = Map::new();
            for (i, name) in names.iter().enumerate() {
                let value = match row.get_ref(i)? {
                    ValueRef::Null => Value::Null,
                    ValueRef::Integer(n) => json!(n),
                    ValueRef::Real(f) => json!(f),
                    ValueRef::Text(t) => json!(String::from_utf8_lossy(t)),
                    ValueRef::Blob(_) => Value::Null,
                };
                map.insert(name.clone(), value);
            }
            Ok(map)
        }) else { return vec![] };
        mapped.filter_map(Result::ok).collect()
    }

    /// Where the last sync wrote (recorded since 0.3.0), then the default folder for older syncs.
    fn dirs_for(&self, slug: &str) -> Vec<PathBuf> {
        let has_out_dir = self.rows("PRAGMA table_info(communities)", &[]).iter().any(|c| c["name"] == "out_dir");
        let mut dirs = vec![];
        if has_out_dir {
            if let Some(Value::String(dir)) = self.rows("SELECT out_dir FROM communities WHERE slug = ?1", &[&slug]).first().and_then(|r| r.get("out_dir")) {
                dirs.push(PathBuf::from(dir));
            }
        }
        let fallback = default_out_root().join(slug);
        if !dirs.contains(&fallback) {
            dirs.push(fallback);
        }
        dirs
    }

    fn video_for(&self, row: &Map<String, Value>) -> Option<PathBuf> {
        let community = row.get("community")?.as_str()?;
        find_video(
            &self.dirs_for(community),
            row.get("course").and_then(Value::as_str),
            row.get("position").and_then(Value::as_i64).unwrap_or(0),
            row.get("title").and_then(Value::as_str).unwrap_or(""),
        )
    }

    fn lesson(&self, id: &str) -> Option<Map<String, Value>> {
        // `resources` arrived in 0.3.0; an older db just lacks the column.
        let has_resources = self.rows("PRAGMA table_info(items)", &[]).iter().any(|c| c["name"] == "resources");
        let sql = format!(
            "SELECT i.id, i.community, i.course, i.section, i.position, i.title, i.url, i.duration_ms,
                    i.body_text, {} AS resources, t.status, t.reason, t.text, t.word_count, t.source_url
             FROM items i LEFT JOIN transcripts t ON t.item_id = i.id WHERE i.id = ?1",
            if has_resources { "i.resources" } else { "NULL" }
        );
        self.rows(&sql, &[&id]).into_iter().next()
    }

    fn library(&self) -> Value {
        let communities = self.rows("SELECT slug, name, last_synced_at FROM communities ORDER BY last_synced_at DESC", &[]);
        let mut items = self.rows(
            "SELECT i.id, i.community, i.course, i.section, i.position, i.title, i.duration_ms, i.has_access,
                    t.status, t.word_count
             FROM items i LEFT JOIN transcripts t ON t.item_id = i.id
             WHERE i.type = 'lesson' ORDER BY i.community, i.rowid",
            &[],
        );
        for item in items.iter_mut() {
            let has_video = self.video_for(item).is_some();
            item.insert("has_video".into(), json!(has_video));
        }
        let out: Vec<Value> = communities
            .into_iter()
            .filter_map(|mut c| {
                let slug = c.get("slug")?.as_str()?.to_string();
                let mine: Vec<Value> = items.iter().filter(|i| i["community"] == slug.as_str()).cloned().map(Value::Object).collect();
                if mine.is_empty() {
                    return None;
                }
                c.insert("items".into(), Value::Array(mine));
                Some(Value::Object(c))
            })
            .collect();
        Value::Array(out)
    }

    fn search(&self, term: &str) -> Value {
        let term = term.trim();
        if term.chars().count() < 2 {
            return json!([]);
        }
        let escaped: String = term.chars().flat_map(|c| if matches!(c, '\\' | '%' | '_') { vec!['\\', c] } else { vec![c] }).collect();
        let like = format!("%{escaped}%");
        let rows = self.rows(
            "SELECT i.id, i.community, i.course, i.title, t.text
             FROM items i LEFT JOIN transcripts t ON t.item_id = i.id
             WHERE i.type = 'lesson' AND (i.title LIKE ?1 ESCAPE '\\' OR t.text LIKE ?1 ESCAPE '\\')
             LIMIT 60",
            &[&like],
        );
        Value::Array(
            rows.into_iter()
                .map(|mut r| {
                    let text = r.remove("text").and_then(|t| t.as_str().map(String::from)).unwrap_or_default();
                    r.insert("snippet".into(), json!(snippet(&text, term, 90)));
                    Value::Object(r)
                })
                .collect(),
        )
    }
}

fn query_param(uri: &tauri::http::Uri, key: &str) -> String {
    uri.query()
        .unwrap_or("")
        .split('&')
        .filter_map(|pair| pair.split_once('='))
        .find(|(k, _)| *k == key)
        .map(|(_, v)| percent_encoding::percent_decode_str(&v.replace('+', " ")).decode_utf8_lossy().into_owned())
        .unwrap_or_default()
}

fn respond(status: StatusCode, content_type: &str, body: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder().status(status).header(header::CONTENT_TYPE, content_type).body(body).unwrap()
}

fn json_response(value: Value) -> Response<Vec<u8>> {
    respond(StatusCode::OK, "application/json", value.to_string().into_bytes())
}

/// Byte-range video responses, which is what lets the player seek when a timestamp is clicked.
fn video_response(path: &Path, range: Option<&str>) -> Response<Vec<u8>> {
    let Ok(mut file) = File::open(path) else { return respond(StatusCode::NOT_FOUND, "text/plain", vec![]) };
    let size = file.metadata().map(|m| m.len()).unwrap_or(0);
    let parsed = range.and_then(|r| r.strip_prefix("bytes=")).and_then(|r| r.split_once('-'));
    let (start, end) = match parsed {
        Some(("", suffix)) => (size.saturating_sub(suffix.parse().unwrap_or(0)), size.saturating_sub(1)),
        Some((s, e)) => {
            let start: u64 = s.parse().unwrap_or(0);
            let end = e.parse().unwrap_or(u64::MAX).min(start + VIDEO_CHUNK - 1).min(size.saturating_sub(1));
            (start, end)
        }
        None => (0, (VIDEO_CHUNK - 1).min(size.saturating_sub(1))),
    };
    if size == 0 || start >= size || start > end {
        return Response::builder().status(StatusCode::RANGE_NOT_SATISFIABLE).header(header::CONTENT_RANGE, format!("bytes */{size}")).body(vec![]).unwrap();
    }
    let mut buf = vec![0; (end - start + 1) as usize];
    if file.seek(SeekFrom::Start(start)).and_then(|_| file.read_exact(&mut buf)).is_err() {
        return respond(StatusCode::INTERNAL_SERVER_ERROR, "text/plain", vec![]);
    }
    Response::builder()
        .status(StatusCode::PARTIAL_CONTENT)
        .header(header::CONTENT_TYPE, "video/mp4")
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{size}"))
        .header(header::CONTENT_LENGTH, buf.len().to_string())
        .body(buf)
        .unwrap()
}

fn handle(request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let uri = request.uri();
    let library = Library::open();
    match uri.path() {
        "/" => respond(StatusCode::OK, "text/html; charset=utf-8", PAGE.as_bytes().to_vec()),
        "/api/library" => json_response(library.library()),
        "/api/item" => {
            let Some(mut row) = library.lesson(&query_param(uri, "id")) else { return json_response(Value::Null) };
            let has_video = library.video_for(&row).is_some();
            row.insert("has_video".into(), json!(has_video));
            json_response(Value::Object(row))
        }
        "/api/search" => json_response(library.search(&query_param(uri, "q"))),
        "/video" => {
            let range = request.headers().get(header::RANGE).and_then(|v| v.to_str().ok());
            match library.lesson(&query_param(uri, "id")).and_then(|row| library.video_for(&row)) {
                Some(path) => video_response(&path, range),
                None => respond(StatusCode::NOT_FOUND, "text/plain", vec![]),
            }
        }
        _ => respond(StatusCode::NOT_FOUND, "text/plain", vec![]),
    }
}

/// Links out of the library (Skool, resource docs) open in the person's own browser.
fn open_external(url: &str) {
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(url).spawn();
    #[cfg(target_os = "linux")]
    let _ = std::process::Command::new("xdg-open").arg(url).spawn();
    #[cfg(target_os = "windows")]
    let _ = std::process::Command::new("cmd").args(["/C", "start", "", url]).spawn();
}

fn main() {
    tauri::Builder::default()
        .register_uri_scheme_protocol("skrape", |_ctx, request| handle(&request))
        .setup(|app| {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::CustomProtocol("skrape://localhost/".parse().unwrap()))
                .title("skrape library")
                .inner_size(1280.0, 820.0)
                .min_inner_size(420.0, 520.0)
                .background_color(tauri::webview::Color(4, 6, 4, 255))
                .on_navigation(|url| {
                    if matches!(url.scheme(), "http" | "https") {
                        open_external(url.as_str());
                        return false;
                    }
                    true
                })
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running skrape library");
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Expected values come from running the TypeScript slugify, so video paths match sync's.
    #[test]
    fn slugify_matches_the_cli() {
        for (input, expected) in [
            ("How To Create a FB Ad Account!", "how-to-create-a-fb-ad-account"),
            ("🚀ROAD TO 8-FIGURES🚀", "road-to-8-figures"),
            ("Café  --  Déjà_vu", "cafe-dejavu"),
            ("(NEW) Install Static Skill", "new-install-static-skill"),
            ("!!!", "untitled"),
            ("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa bcd", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-b"),
            ("Step 9-  How To Launch Ads", "step-9-how-to-launch-ads"),
        ] {
            assert_eq!(slugify(input), expected, "{input}");
        }
    }

    #[test]
    fn snippet_matches_the_cli() {
        assert_eq!(snippet("[0:00] aaa needle bbb", "needle", 4), "…aaa needle bbb…");
    }

    #[test]
    fn video_ranges_are_capped_and_seekable() {
        let path = std::env::temp_dir().join("skrape-range-test.mp4");
        std::fs::write(&path, b"0123456789").unwrap();
        let res = video_response(&path, Some("bytes=2-4"));
        assert_eq!(res.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(res.body(), b"234");
        assert_eq!(video_response(&path, Some("bytes=-3")).body(), b"789");
        assert_eq!(video_response(&path, Some("bytes=20-")).status(), StatusCode::RANGE_NOT_SATISFIABLE);
    }
}
