import { describe, it, expect } from 'vitest';
import { parseRequestLine, splitLines, validateHeader } from '../../src/server';

describe('parseRequestLine', () => {
    it('parses valid GET request', () => {
        const [method, uri, version] = parseRequestLine(Buffer.from('GET / HTTP/1.1'));
        
        expect(method).toBe('GET');
        expect(uri.toString()).toBe('/');
        expect(version).toBe('HTTP/1.1');
    });

    it('parses POST with path', () => {
        const [method, uri, version] = parseRequestLine(Buffer.from('POST /api/users HTTP/1.1'));
        
        expect(method).toBe('POST');
        expect(uri.toString()).toBe('/api/users');
        expect(version).toBe('HTTP/1.1')
    });

    it('throws on missing version', () => {
        expect(() => parseRequestLine(Buffer.from('GET /'))).toThrow();
    });
});

describe('splitLines', () => {
    it('splits on CRLF', () => {
        const lines = splitLines(Buffer.from('Line1\r\nLine2\r\n\r\n'));
        
        expect(lines.length).toBe(3);
        expect(lines[0]!.toString()).toBe('Line1');
        expect(lines[1]!.toString()).toBe('Line2');
        expect(lines[2]!.toString()).toBe('');
    });
});

describe('validateHeader', () => {
    it('accepts valid header', () => {
        expect(validateHeader(Buffer.from('Host: example.com'))).toBe(true);
    });

    it('rejects empty name', () => {
        expect(validateHeader(Buffer.from(': value'))).toBe(false);
    });

    it('rejects CRLF injection', () => {
        expect(validateHeader(Buffer.from('X: val\r\n\r\nGET /evil'))).toBe(false);
    });
});