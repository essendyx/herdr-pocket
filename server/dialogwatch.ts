// Merkt sich pro wartendem Agent den Hash der sichtbaren Frage. Ändert er sich ohne Statuswechsel
// (z. B. zweite Teilfrage einer Auswahlfrage), muss die App neu laden.
export class DialogWatch {
  private last = new Map<string, string | null>();
  update(pane: string, hash: string | null): boolean {
    const had = this.last.has(pane), prev = this.last.get(pane);
    this.last.set(pane, hash);
    return had && prev !== hash;
  }
  keepOnly(panes: string[]) {
    const keep = new Set(panes);
    for (const k of [...this.last.keys()]) if (!keep.has(k)) this.last.delete(k);
  }
}
