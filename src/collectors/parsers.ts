export interface ParsedCollectorLine {
  isPrompt: boolean;
  workspace?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function parseClaudeJsonlLine(line: string): ParsedCollectorLine | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    if (!isRecord(parsed)) {
      return null;
    }

    return {
      isPrompt: parsed['role'] === 'user' || parsed['type'] === 'user',
      workspace: asString(parsed['cwd']),
    };
  } catch {
    return null;
  }
}

export function parseCodexJsonlLine(line: string): ParsedCollectorLine | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    if (!isRecord(parsed)) {
      return null;
    }

    const payload = isRecord(parsed['payload']) ? parsed['payload'] : undefined;
    const isPrompt =
      parsed['role'] === 'user' ||
      parsed['type'] === 'user' ||
      (parsed['type'] === 'event_msg' && payload?.['type'] === 'user_message');

    return {
      isPrompt,
      workspace: asString(parsed['cwd']) ?? asString(payload?.['cwd']),
    };
  } catch {
    return null;
  }
}
