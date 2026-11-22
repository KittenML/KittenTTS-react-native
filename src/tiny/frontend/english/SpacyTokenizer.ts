// spaCy's English tokenizer (spacy/tokenizer.pyx, v3.8), as misaki runs it before
// tagging. The algorithm is ported line by line; the regexes and special cases come
// from en_core_web_sm through tools/kitten-tts-2-tiny/export_english.py. The cache is
// left out: it only replays earlier results.

import { pyIsSpaceChar } from '../pystr';

export interface JsRegex {
  source: string;
  flags: string;
}

export interface SpacyTokenizerData {
  prefix: JsRegex;
  suffix: JsRegex;
  infix: JsRegex;
  url: JsRegex | null;
  tokenMatch: JsRegex | null;
  /** Special case -> its tokens as [ORTH, NORM or null]. */
  specials: Record<string, Array<[string, string | null]>>;
  /** The special cases the final matcher pass looks for (faster_heuristics). */
  matcher: string[];
}

export interface SpacyToken {
  text: string;
  /** Followed by a single space. */
  spacy: boolean;
  /** A special case's NORM; otherwise the lexeme's norm applies. */
  norm?: string;
}

export class SpacyTokenizer {
  private readonly prefix: RegExp;
  private readonly suffix: RegExp;
  private readonly infix: RegExp;
  private readonly url: RegExp | null;
  private readonly tokenMatch: RegExp | null;
  private readonly specials: Map<string, Array<[string, string | null]>>;
  private readonly matcherStrings: string[];
  private patterns: Map<string, string[][]> | null = null;

  constructor(data: SpacyTokenizerData) {
    this.prefix = new RegExp(data.prefix.source, data.prefix.flags);
    this.suffix = new RegExp(data.suffix.source, data.suffix.flags);
    this.infix = new RegExp(data.infix.source, data.infix.flags + 'g');
    // re.match: anchored at the start, which the sticky flag gives.
    this.url = data.url ? new RegExp(data.url.source, data.url.flags + 'y') : null;
    this.tokenMatch = data.tokenMatch
      ? new RegExp(data.tokenMatch.source, data.tokenMatch.flags + 'y')
      : null;
    this.specials = new Map(Object.entries(data.specials));
    this.matcherStrings = data.matcher;
  }

  tokenize(text: string): SpacyToken[] {
    const doc = this.tokenizeAffixes(text, true);
    return this.applySpecialCases(doc);
  }

  private tokenizeAffixes(text: string, withSpecials: boolean): SpacyToken[] {
    const doc: SpacyToken[] = [];
    if (!text) return doc;
    let start = 0;
    let i = 0;
    let inWs = pyIsSpaceChar(String.fromCodePoint(text.codePointAt(0) as number));
    for (const ch of text) {
      if (pyIsSpaceChar(ch) !== inWs) {
        if (start < i) this.span(doc, text.slice(start, i), withSpecials);
        if (ch === ' ') {
          doc[doc.length - 1].spacy = true;
          start = i + 1;
        } else {
          start = i;
        }
        inWs = !inWs;
      }
      i += ch.length;
    }
    if (start < i) {
      this.span(doc, text.slice(start), withSpecials);
      // as in spaCy; always false, since a final " " leaves inWs set
      doc[doc.length - 1].spacy = text[text.length - 1] === ' ' && !inWs;
    }
    return doc;
  }

  private span(doc: SpacyToken[], span: string, withSpecials: boolean): void {
    if (this.trySpecials(span, doc, withSpecials)) return;
    const prefixes: string[] = [];
    const suffixes: string[] = [];
    const rest = this.splitAffixes(span, prefixes, suffixes, withSpecials);
    this.attachTokens(doc, rest, prefixes, suffixes, withSpecials);
  }

  private trySpecials(text: string, doc: SpacyToken[], withSpecials: boolean): boolean {
    if (!withSpecials) return false;
    const special = this.specials.get(text);
    if (!special) return false;
    for (const [orth, norm] of special) {
      doc.push(norm == null ? { text: orth, spacy: false } : { text: orth, spacy: false, norm });
    }
    return true;
  }

  private findPrefix(text: string): number {
    const m = this.prefix.exec(text);
    return m ? m[0].length : 0;
  }

  private findSuffix(text: string): number {
    const m = this.suffix.exec(text);
    return m ? m[0].length : 0;
  }

  private matches(re: RegExp | null, text: string): boolean {
    if (!re) return false;
    re.lastIndex = 0;
    return re.test(text);
  }

  private splitAffixes(
    text: string,
    prefixes: string[],
    suffixes: string[],
    withSpecials: boolean,
  ): string {
    let lastSize = -1;
    while (text && text.length !== lastSize) {
      if (this.matches(this.tokenMatch, text)) break;
      if (withSpecials && this.specials.has(text)) break;
      lastSize = text.length;
      const preLen = this.findPrefix(text);
      let prefix = '';
      let minusPre = '';
      if (preLen !== 0) {
        prefix = text.slice(0, preLen);
        minusPre = text.slice(preLen);
        if (minusPre && withSpecials && this.specials.has(minusPre)) {
          prefixes.push(prefix);
          return minusPre;
        }
      }
      const sufLen = this.findSuffix(text.slice(preLen));
      let suffix = '';
      let minusSuf = '';
      if (sufLen !== 0) {
        suffix = text.slice(text.length - sufLen);
        minusSuf = text.slice(0, text.length - sufLen);
        if (minusSuf && withSpecials && this.specials.has(minusSuf)) {
          suffixes.push(suffix);
          return minusSuf;
        }
      }
      if (preLen && sufLen && preLen + sufLen <= text.length) {
        text = text.slice(preLen, text.length - sufLen);
        prefixes.push(prefix);
        suffixes.push(suffix);
      } else if (preLen) {
        text = minusPre;
        prefixes.push(prefix);
      } else if (sufLen) {
        text = minusSuf;
        suffixes.push(suffix);
      }
    }
    return text;
  }

  private attachTokens(
    doc: SpacyToken[],
    text: string,
    prefixes: string[],
    suffixes: string[],
    withSpecials: boolean,
  ): void {
    for (const p of prefixes) doc.push({ text: p, spacy: false });
    if (text) {
      if (this.trySpecials(text, doc, withSpecials)) {
        // pushed
      } else if (this.matches(this.tokenMatch, text) || this.matches(this.url, text)) {
        doc.push({ text, spacy: false });
      } else {
        const found = Array.from(text.matchAll(this.infix));
        if (found.length === 0) {
          doc.push({ text, spacy: false });
        } else {
          let start = 0;
          const startBeforeInfixes = start;
          for (const m of found) {
            const infixStart = m.index as number;
            const infixEnd = infixStart + m[0].length;
            if (infixStart === startBeforeInfixes) continue;
            if (infixStart !== start) doc.push({ text: text.slice(start, infixStart), spacy: false });
            if (infixStart !== infixEnd) doc.push({ text: text.slice(infixStart, infixEnd), spacy: false });
            start = infixEnd;
          }
          const tail = text.slice(start);
          if (tail) doc.push({ text: tail, spacy: false });
        }
      }
    }
    for (let i = suffixes.length - 1; i >= 0; i--) doc.push({ text: suffixes[i], spacy: false });
  }

  /** The special-case pass after affix splitting (_apply_special_cases with its PhraseMatcher). */
  private applySpecialCases(doc: SpacyToken[]): SpacyToken[] {
    const patterns = this.matcherPatterns();
    const found: Array<{ start: number; end: number }> = [];
    for (let i = 0; i < doc.length; i++) {
      const candidates = patterns.get(doc[i].text);
      if (!candidates) continue;
      for (const p of candidates) {
        if (i + p.length > doc.length) continue;
        let ok = true;
        for (let j = 1; j < p.length; j++) {
          if (doc[i + j].text !== p[j]) {
            ok = false;
            break;
          }
        }
        if (ok) found.push({ start: i, end: i + p.length });
      }
    }
    if (found.length === 0) return doc;
    // _filter_special_spans: longest first, then leftmost; tokens of every span
    // looked at count as seen, kept or not.
    found.sort((a, b) => {
      const la = a.end - a.start;
      const lb = b.end - b.start;
      return la !== lb ? lb - la : a.start - b.start;
    });
    const seen = new Set<number>();
    const kept: Array<{ start: number; end: number }> = [];
    for (const span of found) {
      if (!seen.has(span.start) && !seen.has(span.end - 1)) kept.push(span);
      for (let k = span.start; k < span.end; k++) seen.add(k);
    }
    kept.sort((a, b) => a.start - b.start);
    const byStart = new Map(kept.map(s => [s.start, s]));
    const out: SpacyToken[] = [];
    let i = 0;
    while (i < doc.length) {
      const span = byStart.get(i);
      if (!span) {
        out.push(doc[i]);
        i += 1;
        continue;
      }
      let text = '';
      for (let k = span.start; k < span.end; k++) {
        text += doc[k].text + (k < span.end - 1 && doc[k].spacy ? ' ' : '');
      }
      const special = this.specials.get(text);
      if (!special) {
        for (let k = span.start; k < span.end; k++) out.push(doc[k]);
      } else {
        const finalSpacy = doc[span.end - 1].spacy;
        special.forEach(([orth, norm], k) => {
          const tok: SpacyToken = { text: orth, spacy: false };
          if (norm != null) tok.norm = norm;
          if (k === special.length - 1) tok.spacy = finalSpacy;
          out.push(tok);
        });
      }
      i = span.end;
    }
    return out;
  }

  private matcherPatterns(): Map<string, string[][]> {
    if (this.patterns) return this.patterns;
    const patterns = new Map<string, string[][]>();
    for (const s of this.matcherStrings) {
      const orths = this.tokenizeAffixes(s, false).map(t => t.text);
      if (orths.length === 0) continue;
      const list = patterns.get(orths[0]) ?? [];
      list.push(orths);
      patterns.set(orths[0], list);
    }
    this.patterns = patterns;
    return patterns;
  }
}
