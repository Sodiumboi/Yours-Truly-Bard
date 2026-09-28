import type { Command } from "./Command";
import play from "./play";
import skip from "./skip";
import loop from "./loop";
import list from "./list";
import stop from "./stop";

export const commands: Command[] = [play, skip, loop, list, stop];
