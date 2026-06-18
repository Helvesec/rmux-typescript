export class PaneExitState {
  readonly dead: boolean;
  readonly status?: number;

  constructor(dead: boolean, status?: number) {
    this.dead = dead;
    if (status !== undefined) {
      this.status = status;
    }
  }
}
