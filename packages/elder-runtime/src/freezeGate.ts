export class FreezeGate {
  private frozen = false;

  isFrozen(): boolean { return this.frozen; }
  freeze(): void { this.frozen = true; }
  unfreeze(): void { this.frozen = false; }
}
