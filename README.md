# skrape

Read Skool course content instead of watching it.

`skrape` pulls the classroom of a Skool community **you already pay for and
belong to**, and writes clean, readable, timestamped transcripts to disk,
so you can read a lesson in two minutes instead of watching a 20-minute video.

It works because Skool ships the whole course tree as structured data inside
each page, and course videos are almost always hosted on Loom, which publishes
caption tracks. No audio download, no speech-to-text, no scraping of anything
that isn't already sitting on the page you're allowed to see.

## Before you use this

**This is a personal tool for your own communities.** It signs in as *you*,
using *your* real browser session, and only ever touches courses your account
already has access to. It can't and won't bypass Skool's own paywall or
membership checks.

Automating access to a platform like this generally sits outside most
platforms' terms of service, even when you're a legitimate paying member and
even when nothing is being redistributed. Running this is a decision about
your own account, and it's yours to make. This tool doesn't make it for you,
and it doesn't hide what it's doing (see [How it works](#how-it-works)).
Don't use it on communities you don't belong to, don't share or republish
what it produces, and don't run it in a way designed to look like normal
browsing if you wouldn't be comfortable explaining what it does.

If a course creator you follow would rather you didn't do this, respect that.

## Install

    curl -fsSL https://skrape.abovetopsecret.ai/install | bash
    skrape

That's the whole setup. First run installs the browser skrape needs (a
one-time, ~150MB download) if it isn't already on your machine, then walks
you through everything:

1. Checks whether you're signed in, and if not, opens a real Chrome window for
   you to sign in yourself. Nothing is typed on your behalf, and your
   password never passes through this tool.
2. Looks up the communities your account belongs to and lets you pick one
   with the arrow keys (an "enter a slug manually" option is always there
   too, in case discovery doesn't find one).
3. Shows you what's about to happen (the community, how many courses were
   found, where files will land) and waits for you to confirm before any
   work starts. Pick **Transcripts** or **Transcripts + videos**.
4. Runs the sync with a live progress bar. You can Ctrl+C at any point; it
   cleans up after itself.
5. Prints a summary: outcome counts, total words, the output path, and a
   readable list of anything that wasn't transcribed and why. Nothing is
   silently dropped from the count.

From there you can sync another community, re-sync the same one (it's
incremental: already-fetched lessons are skipped), open the output folder,
or quit.

Output lands in `~/skrape/<slug>/transcripts/<course>/NN-lesson.md`, and videos
(if you asked for them) in `~/skrape/<slug>/videos/<course>/NN-lesson.mp4`,
wherever you run skrape from.

### Browsing your library

    skrape library

Opens a local web library of everything you've synced, in your browser:
search every transcript at once, read course by course, and play downloaded
videos with the transcript alongside. Click a timestamp to jump the video
there. It runs on `127.0.0.1` only and never uploads anything. Ctrl+C stops it.

### Downloading videos

Video downloads are opt-in and use [yt-dlp](https://github.com/yt-dlp/yt-dlp),
which you install once yourself:

    brew install yt-dlp ffmpeg      # macOS; see yt-dlp's docs for other platforms

skrape hands each lesson's video link to yt-dlp, which covers Loom, YouTube,
Vimeo, Wistia and most other hosts. A video that's already on disk is skipped,
so re-running a sync only fetches what's missing. Videos are big (a 20-minute
Loom lesson is ~150MB), so check your free disk space before pulling a whole
community.

### Scripting / advanced use

The underlying subcommands work directly too, without the guided flow:

    skrape login                     # once: sign in by hand, session persists
    skrape sync <slug>                # slug is the part after skool.com/
    skrape sync <slug> -o ~/notes -c 4  # custom output dir / concurrency
    skrape sync <slug> --videos       # transcripts + every lesson video
    skrape library                    # browse it all in a local web UI

### Building from source

    git clone <this repo>
    cd skrape
    npm install
    npm run build
    npm link                        # or: npm install -g .

(Then `node dist/cli.js <command>` also works if you haven't `npm link`ed it.)

## How it works

Skool ships the full course tree as JSON inside each classroom page, with no
clicking through lesson by lesson. `skrape` reads that structure the way any
browser or crawler would: an authenticated request to a page your account
can already open.

Course videos are checked against known caption-providing hosts (Loom, at the
moment). Where a caption track exists, it's downloaded and cleaned into
readable prose with timestamp anchors. Where one doesn't, the lesson is
reported as not transcribed rather than silently skipped.

When a page doesn't come back with the data the tool expects (an expired
session, or Skool changing how a page is built), it falls back to driving an
actual browser window using your already-authenticated profile, rather than
guessing or failing silently.

Nothing about this hides its footprint: requests carry a normal browser user
agent, run at a modest, bounded concurrency, and only ever happen when you
run the command.

## What this doesn't do

- Doesn't work on communities you're not a member of. There's no bypass for
  Skool's own access checks, because none of the data is reachable without
  them.
- Doesn't redistribute or publish anything. Output is written to your local
  disk for you to read.
- Doesn't store your password. Sign-in happens in a real Chrome window that
  only you interact with.
- Doesn't download videos unless you ask it to (`--videos`, or **Transcripts + videos**
  in the guided flow).
- Doesn't download lesson `resources`: those are links to outside docs
  (Google Docs, etc.), not files hosted on Skool.
- Doesn't transcribe video hosts it doesn't recognize. Those lessons show up
  in the summary as not transcribed, with a reason.

## License

MIT. See [LICENSE](LICENSE). In short: do what you like with the code, no
warranty, use it at your own risk and your own judgment about the platforms
you point it at.
