/** Shared knowledge-audit classification for provider shell activity. */

const READ_OR_SEARCH_COMMAND = /(?:^|[\s;&|'"(])(?:cat|head|tail|less|more|sed|rg|grep|find|fd)\s/u;
const SEARCH_COMMAND = /(?:^|[\s;&|'"(])(?:rg|grep|find|fd)\s/u;

export function shellCommandConsultsFiles(command: string): boolean {
  return READ_OR_SEARCH_COMMAND.test(command);
}

export function shellCommandSearches(command: string): boolean {
  return SEARCH_COMMAND.test(command);
}
