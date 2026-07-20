import { BaseFile } from './base';
import type {
  TxtDecodeCandidate,
  TxtEncoding,
  TxtSourceLine,
} from '../../model/TxtCatalog';
import { decodeTxtBuffer, decodeTxtText } from './TxtDecode';

export class Txt extends BaseFile {
  type = 'txt' as const;
  text: string = '';
  encoding: TxtEncoding = 'utf-8';
  lines: TxtSourceLine[] = [];
  decodeCandidates: TxtDecodeCandidate[] = [];

  private async parseFile(file: File) {
    const buffer = await file.arrayBuffer();
    const decoded = decodeTxtBuffer(buffer);
    this.text = decoded.text;
    this.encoding = decoded.encoding;
    this.lines = decoded.lines;
    this.decodeCandidates = decoded.candidates;
  }

  static async fromFile(file: File) {
    const txt = new Txt(file.name, file);
    await txt.parseFile(file);
    return txt;
  }

  static async fromText(name: string, text: string) {
    const txt = new Txt(name);
    const decoded = decodeTxtText(text);
    txt.text = decoded.text;
    txt.encoding = decoded.encoding;
    txt.lines = decoded.lines;
    txt.decodeCandidates = decoded.candidates;
    return txt;
  }

  async clone() {
    if (!this.rawFile)
      throw new Error('Cannot clone manually constructed file.');
    return Txt.fromFile(this.rawFile);
  }

  async toBlob() {
    return new Blob([this.text], {
      type: 'text/plain',
    });
  }
}
