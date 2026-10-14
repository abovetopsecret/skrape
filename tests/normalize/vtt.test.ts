import { describe, it, expect } from 'vitest';
import { parseVtt } from '../../src/normalize/vtt.js';

const vtt = (body: string) => `WEBVTT\n\n${body}`;

describe('parseVtt', () => {
  it('strips the WEBVTT header, cue numbers and timestamps from the prose', () => {
    const out = parseVtt(vtt('1\n00:00:00.500 --> 00:00:02.000\nHello there.\n'));
    expect(out.text).not.toContain('WEBVTT');
    expect(out.text).not.toContain('-->');
    expect(out.text).toContain('Hello there.');
  });

  it('strips speaker tags like <v 0>', () => {
    const out = parseVtt(vtt('00:00:00.000 --> 00:00:01.000\n<v 0>Alright, listen.\n'));
    expect(out.text).toContain('Alright, listen.');
    expect(out.text).not.toContain('<v');
  });

  it('drops consecutive duplicate cues (rolling captions)', () => {
    const out = parseVtt(vtt(
      '00:00:00.000 --> 00:00:01.000\nSame line.\n\n' +
      '00:00:01.000 --> 00:00:02.000\nSame line.\n\n' +
      '00:00:02.000 --> 00:00:03.000\nNew line.\n'
    ));
    expect(out.text.match(/Same line\./g)).toHaveLength(1);
    expect(out.cueCount).toBe(2);
  });

  it('keeps a non-consecutive repeat, because saying something twice is legitimate', () => {
    const out = parseVtt(vtt(
      '00:00:00.000 --> 00:00:01.000\nTest it.\n\n' +
      '00:00:01.000 --> 00:00:02.000\nThen wait.\n\n' +
      '00:00:02.000 --> 00:00:03.000\nTest it.\n'
    ));
    expect(out.text.match(/Test it\./g)).toHaveLength(2);
  });

  it('prefixes each paragraph with an [mm:ss] anchor from its first cue', () => {
    const out = parseVtt(vtt('00:01:05.000 --> 00:01:07.000\nStarts here.\n'));
    expect(out.text).toMatch(/^\[1:05\] /);
  });

  it('renders anchors past an hour as total minutes, not wrapping to zero', () => {
    const out = parseVtt(vtt('01:02:03.000 --> 01:02:05.000\nLate in the video.\n'));
    expect(out.text).toMatch(/^\[62:03\] /);
  });

  it('breaks paragraphs on sentence ends once they have heft', () => {
    const long = 'This sentence is padded out to carry real length. '.repeat(12).trim();
    const out = parseVtt(vtt(
      `00:00:00.000 --> 00:00:20.000\n${long}\n\n` +
      '00:00:20.000 --> 00:00:22.000\nA second paragraph begins.\n'
    ));
    expect(out.text.split('\n\n').length).toBeGreaterThan(1);
  });

  it('counts words across all retained cues', () => {
    const out = parseVtt(vtt(
      '00:00:00.000 --> 00:00:01.000\none two three\n\n' +
      '00:00:01.000 --> 00:00:02.000\nfour five\n'
    ));
    expect(out.wordCount).toBe(5);
  });

  it('returns empty output for a header-only file rather than throwing', () => {
    const out = parseVtt('WEBVTT\n\n');
    expect(out.text).toBe('');
    expect(out.wordCount).toBe(0);
    expect(out.cueCount).toBe(0);
  });

  it('ignores NOTE blocks', () => {
    const out = parseVtt(vtt('NOTE this is a comment\n\n00:00:00.000 --> 00:00:01.000\nReal text.\n'));
    expect(out.text).not.toContain('comment');
    expect(out.text).toContain('Real text.');
  });

  it('ignores multi-line NOTE blocks until the next blank line', () => {
    const out = parseVtt(vtt(
      'NOTE\n' +
      'This is a multi-line comment.\n' +
      'It spans multiple lines.\n' +
      '\n' +
      '00:00:00.000 --> 00:00:01.000\n' +
      'Real text.\n'
    ));
    expect(out.text).not.toContain('comment');
    expect(out.text).not.toContain('spans');
    expect(out.text).toContain('Real text.');
    expect(out.cueCount).toBe(1);
  });

  it('accumulates multi-line cue text into a single cue', () => {
    const out = parseVtt(vtt(
      '00:00:00.000 --> 00:00:02.000\n' +
      'Hello there.\n' +
      'This is more.\n' +
      '\n' +
      '00:00:02.000 --> 00:00:03.000\n' +
      'New cue.\n'
    ));
    expect(out.cueCount).toBe(2);
    expect(out.text).toContain('Hello there. This is more.');
    expect(out.text).toContain('New cue.');
  });

  it('handles short-form MM:SS.mmm timestamps without hours', () => {
    const out = parseVtt(vtt('01:05.000 --> 01:07.000\nShort form timestamp.\n'));
    expect(out.text).toMatch(/^\[1:05\] /);
  });
});
