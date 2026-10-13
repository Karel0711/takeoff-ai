/**
 * A small, safe arithmetic evaluator for assembly formulas.
 * Supports numbers, variables, + - * / ^, parentheses, unary minus and
 * the functions ceil, floor, round, min, max, abs. Never uses eval.
 */

export type EvalResult = { ok: true; value: number } | { ok: false; error: string };

type Token =
  | { kind: 'num'; value: number }
  | { kind: 'id'; name: string }
  | { kind: 'op'; op: string };

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  ceil: Math.ceil,
  floor: Math.floor,
  round: Math.round,
  abs: Math.abs,
  min: Math.min,
  max: Math.max,
};

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
    } else if (/[\d.]/.test(c)) {
      const match = /^\d*\.?\d+(?:e[+-]?\d+)?|^\d+\.?/i.exec(src.slice(i));
      if (!match) throw new Error(`Bad number at position ${i + 1}`);
      tokens.push({ kind: 'num', value: Number(match[0]) });
      i += match[0].length;
    } else if (/[A-Za-z_]/.test(c)) {
      const match = /^[A-Za-z_]\w*/.exec(src.slice(i))!;
      tokens.push({ kind: 'id', name: match[0] });
      i += match[0].length;
    } else if ('+-*/^(),'.includes(c)) {
      tokens.push({ kind: 'op', op: c });
      i++;
    } else {
      throw new Error(`Unexpected "${c}" at position ${i + 1}`);
    }
  }
  return tokens;
}

export function evaluate(src: string, vars: Record<string, number>): EvalResult {
  let tokens: Token[];
  try {
    tokens = tokenize(src);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  if (tokens.length === 0) return { ok: false, error: 'Formula is empty' };
  let pos = 0;

  const peekOp = (op: string): boolean => {
    const t = tokens[pos];
    return t !== undefined && t.kind === 'op' && t.op === op;
  };
  const expectOp = (op: string): void => {
    if (!peekOp(op)) throw new Error(`Expected "${op}"`);
    pos++;
  };

  // expr := term (('+'|'-') term)*
  function expr(): number {
    let value = term();
    while (peekOp('+') || peekOp('-')) {
      const op = (tokens[pos++] as { op: string }).op;
      const rhs = term();
      value = op === '+' ? value + rhs : value - rhs;
    }
    return value;
  }
  // term := unary (('*'|'/') unary)*
  function term(): number {
    let value = unary();
    while (peekOp('*') || peekOp('/')) {
      const op = (tokens[pos++] as { op: string }).op;
      const rhs = unary();
      value = op === '*' ? value * rhs : value / rhs;
    }
    return value;
  }
  // unary := '-' unary | power
  function unary(): number {
    if (peekOp('-')) {
      pos++;
      return -unary();
    }
    if (peekOp('+')) {
      pos++;
      return unary();
    }
    return power();
  }
  // power := primary ('^' unary)?
  function power(): number {
    const base = primary();
    if (peekOp('^')) {
      pos++;
      return base ** unary();
    }
    return base;
  }
  function primary(): number {
    const t = tokens[pos];
    if (!t) throw new Error('Formula ends unexpectedly');
    if (t.kind === 'num') {
      pos++;
      return t.value;
    }
    if (t.kind === 'id') {
      pos++;
      if (peekOp('(')) {
        const fn = FUNCTIONS[t.name.toLowerCase()];
        if (!fn) throw new Error(`Unknown function "${t.name}"`);
        pos++;
        const args = [expr()];
        while (peekOp(',')) {
          pos++;
          args.push(expr());
        }
        expectOp(')');
        return fn(...args);
      }
      if (!(t.name in vars)) throw new Error(`Unknown variable "${t.name}"`);
      return vars[t.name];
    }
    if (t.op === '(') {
      pos++;
      const value = expr();
      expectOp(')');
      return value;
    }
    throw new Error(`Unexpected "${t.op}"`);
  }

  try {
    const value = expr();
    if (pos < tokens.length) throw new Error('Unexpected text after formula');
    if (!Number.isFinite(value)) return { ok: false, error: 'Result is not a finite number' };
    return { ok: true, value };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
