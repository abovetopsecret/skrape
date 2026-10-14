import { describe, it, expect } from 'vitest';
import { extractNextData, PayloadParseError } from '../../src/fetch/nextdata.js';

describe('extractNextData', () => {
  it('parses the embedded payload', () => {
    const html = `<html><script id="__NEXT_DATA__" type="application/json">{"props":{"a":1}}</script></html>`;
    expect(extractNextData(html)).toEqual({ props: { a: 1 } });
  });

  it('throws PayloadParseError when the script tag is missing', () => {
    expect(() => extractNextData('<html><body>login</body></html>')).toThrow(PayloadParseError);
  });

  it('throws PayloadParseError on malformed JSON rather than a raw SyntaxError', () => {
    const html = `<script id="__NEXT_DATA__">{"props":</script>`;
    expect(() => extractNextData(html)).toThrow(PayloadParseError);
  });

  it('handles payloads containing a closing script tag in a string', () => {
    const html = `<script id="__NEXT_DATA__">{"a":"x"}</script><script>var b = 1;</script>`;
    expect(extractNextData(html)).toEqual({ a: 'x' });
  });
});
