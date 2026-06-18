import { rowColumn, TextMatch } from "./expectations.js";

export class PaneSnapshot {
  readonly visibleText: string;

  constructor(visibleText: string) {
    this.visibleText = visibleText;
  }

  get visible_text(): string {
    return this.visibleText;
  }

  get lines(): readonly string[] {
    return this.visibleText.split(/\r?\n/).filter((line, index, lines) => {
      return index < lines.length - 1 || line.length > 0;
    });
  }

  rowText(row: number): string {
    const line = this.lines[row];
    if (line === undefined) {
      throw new RangeError(`row is outside the snapshot: ${row}`);
    }
    return line;
  }

  findText(text: string): TextMatch | undefined {
    const index = this.visibleText.indexOf(text);
    if (index < 0) {
      return undefined;
    }
    const [row, column] = rowColumn(this.visibleText, index);
    return new TextMatch(text, row, column);
  }

  findAllText(text: string): readonly TextMatch[] {
    if (text.length === 0) {
      return [];
    }

    const matches: TextMatch[] = [];
    let start = 0;
    for (;;) {
      const index = this.visibleText.indexOf(text, start);
      if (index < 0) {
        return matches;
      }
      const [row, column] = rowColumn(this.visibleText, index);
      matches.push(new TextMatch(text, row, column));
      start = index + text.length;
    }
  }
}
