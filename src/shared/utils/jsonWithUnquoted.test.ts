import {
  parseJsonWithUnquoted,
  stringifyJsonWithUnquoted,
  mergeUnquotedFields,
  detectUnquotedFields,
  wrapQuotes,
  unwrapQuotes,
} from "./jsonWithUnquoted";

/**
 * Characterization + adversarial + property test suite for the frame-system
 * serialization round-trip surface (ADR 0018: SpaceOuter always frame-renders,
 * so this module is load-bearing). Prior to this file the module had ZERO
 * coverage. See bd Notidian-35u.
 *
 * IMPORTANT: This suite is a CHARACTERIZATION harness — it pins the CURRENT
 * behavior, including several documented bugs/lossiness, so any future change is
 * a deliberate, visible diff. Where a genuine defect is captured, the assertion
 * is annotated `BUG(<follow-up bead>)` and a follow-up bead is filed. Do NOT
 * "fix" these by changing the assertion; fix the source and update the test in
 * the same change.
 */

// parseWithUnquotedStrings calls console.error on total parse failure (the
// silent-{} path). Silence it so the suite output stays readable, but keep a
// reference so we can assert it fires where the source documents data loss.
let errorSpy: jest.SpyInstance;
beforeEach(() => {
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  errorSpy.mockRestore();
});

describe("parseJsonWithUnquoted — standard JSON fast-path (line 25)", () => {
  it("parses a well-formed JSON object losslessly with no unquoted markers", () => {
    const { value, unquotedFields } = parseJsonWithUnquoted('{"a":1,"b":"x"}');
    expect(value).toEqual({ a: 1, b: "x" });
    expect(unquotedFields).toEqual({});
  });

  it("parses top-level arrays via the fast-path", () => {
    expect(parseJsonWithUnquoted("[1,2,3]").value).toEqual([1, 2, 3]);
  });

  it("parses JSON primitives via the fast-path", () => {
    expect(parseJsonWithUnquoted('"hello"').value).toBe("hello");
    expect(parseJsonWithUnquoted("123").value).toBe(123);
    expect(parseJsonWithUnquoted("true").value).toBe(true);
    expect(parseJsonWithUnquoted("null").value).toBeNull();
  });

  it("nested objects + arrays survive the fast-path unchanged", () => {
    const input = { command: "spaces://x", parameters: { a: [1, 2], b: { c: "d" } } };
    const { value, unquotedFields } = parseJsonWithUnquoted(JSON.stringify(input));
    expect(value).toEqual(input);
    expect(unquotedFields).toEqual({});
  });
});

describe("parseJsonWithUnquoted — boundary / invalid input", () => {
  it("returns null + empty markers for null/undefined/non-string input (line 17)", () => {
    expect(parseJsonWithUnquoted(null as any)).toEqual({ value: null, unquotedFields: {} });
    expect(parseJsonWithUnquoted(undefined as any)).toEqual({ value: null, unquotedFields: {} });
    expect(parseJsonWithUnquoted(42 as any)).toEqual({ value: null, unquotedFields: {} });
    expect(parseJsonWithUnquoted({} as any)).toEqual({ value: null, unquotedFields: {} });
  });

  it("treats the empty string as null (falsy short-circuit, line 17)", () => {
    expect(parseJsonWithUnquoted("")).toEqual({ value: null, unquotedFields: {} });
  });

  it("returns {} (NOT throw, NOT null) when every parse strategy fails (line 115)", () => {
    // The aggressive fallback is best-effort; total garbage degrades to {} and
    // logs to console.error. This is the silent-loss path — confirm it does NOT
    // throw or leak invalid JSON to a caller.
    const { value, unquotedFields } = parseJsonWithUnquoted("@@@not json at all###");
    expect(value).toEqual({});
    expect(unquotedFields).toEqual({});
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe("parseJsonWithUnquoted — unquoted string values (fallback path, line 53)", () => {
  it("quotes a bare unquoted value and records the field as unquoted", () => {
    const { value, unquotedFields } = parseJsonWithUnquoted("{command: foo}");
    expect(value).toEqual({ command: "foo" });
    expect(unquotedFields).toEqual({ command: true });
  });

  it("records multiple unquoted fields", () => {
    const { value, unquotedFields } = parseJsonWithUnquoted(
      "{command: foo, parameters: bar}"
    );
    expect(value).toEqual({ command: "foo", parameters: "bar" });
    expect(unquotedFields).toEqual({ command: true, parameters: true });
  });

  it("preserves $-expression values as strings and marks them unquoted (line 73)", () => {
    const { value, unquotedFields } = parseJsonWithUnquoted("{command: $abc}");
    expect(value).toEqual({ command: "$abc" });
    expect(unquotedFields).toEqual({ command: true });
  });

  it("preserves dotted property-access values as strings and marks them unquoted (line 73)", () => {
    const { value, unquotedFields } = parseJsonWithUnquoted("{command: a.b}");
    expect(value).toEqual({ command: "a.b" });
    expect(unquotedFields).toEqual({ command: true });
  });

  it("does not mark JSON literals (number/bool/null) as unquoted", () => {
    // These reach the fallback only when sibling fields are unquoted; here we
    // force the fallback with one unquoted field and confirm literals stay typed.
    const { value, unquotedFields } = parseJsonWithUnquoted(
      "{name: foo, count: 5, flag: true}"
    );
    expect(value).toEqual({ name: "foo", count: 5, flag: true });
    expect(unquotedFields).toEqual({ name: true });
    expect(unquotedFields.count).toBeUndefined();
    expect(unquotedFields.flag).toBeUndefined();
  });
});

describe("parseJsonWithUnquoted — wrapped-quote stripping (lines 46-49)", () => {
  it("strips single-quote wrapping and parses the inner JSON object", () => {
    const { value } = parseJsonWithUnquoted("'{\"a\":1}'");
    expect(value).toEqual({ a: 1 });
  });

  it(
    "FIXED(Notidian-fs6, ADR 0026 1a): a double-quote-wrapped object literal " +
      "parses to the inner OBJECT, symmetric with single-quote wrap",
    () => {
      // Canonical wrapper convention: a wrapped frame payload (single- OR
      // double-quote wrapped) parses to the inner OBJECT. Previously
      // '"{\\"a\\":1}"' was itself valid JSON so the fast-path returned the raw
      // inner STRING; now it is unwrapped to the inner literal before the
      // fast-path, so both quote styles deterministically yield the object.
      const { value } = parseJsonWithUnquoted('"{\\"a\\":1}"');
      expect(value).toEqual({ a: 1 });
      expect(typeof value).toBe("object");
    }
  );

  it("a double-quote-wrapped ARRAY literal parses to the inner array (ADR 0026 1a)", () => {
    const { value } = parseJsonWithUnquoted('"[1,2,3]"');
    expect(value).toEqual([1, 2, 3]);
  });

  it(
    "a wrapped SCALAR string is NOT unwrapped to an object — stays a string " +
      "(only object/array literals are normalized, ADR 0026 1a)",
    () => {
      // The inner content is not {...}/[...] so the JSON primitive fast-path
      // contract is preserved: '"hello"' -> "hello".
      expect(parseJsonWithUnquoted('"hello"').value).toBe("hello");
      expect(parseJsonWithUnquoted('"123 not an object"').value).toBe(
        "123 not an object"
      );
    }
  );

  it(
    "a double-quote-wrapped command object normalizes to the OBJECT the action " +
      "consumer expects (ADR 0026 1a — the load-bearing shape)",
    () => {
      const { value } = parseJsonWithUnquoted(
        '"{\\"command\\":\\"spaces://x\\",\\"parameters\\":{\\"a\\":1}}"'
      );
      expect(value).toEqual({ command: "spaces://x", parameters: { a: 1 } });
      // The shape ButtonSubmenu.parsePropValue reads: typeof === object, .command present.
      expect(typeof value).toBe("object");
      expect((value as any).command).toBe("spaces://x");
    }
  );
});

describe("parseJsonWithUnquoted — ADVERSARIAL injection (lines 53, 85, 99-108, 115)", () => {
  it("does NOT allow quote-breakout into a polluted object; degrades to {} safely", () => {
    // A value crafted to close the string and inject a sibling key. The contract
    // we protect: NEVER emit/return invalid JSON or a polluted object — at worst
    // silently lose the data ({}). Confirm no 'injected' key leaks through.
    const { value } = parseJsonWithUnquoted('{command: x", "injected": "y}');
    expect(value).not.toHaveProperty("injected");
    // Current behavior: total failure -> {} (line 115).
    expect(value).toEqual({});
  });

  it(
    "escapes (does not drop) an unquoted value containing an embedded " +
      "double-quote (Notidian-d4u defect 2)",
    () => {
      const { value, unquotedFields } = parseJsonWithUnquoted(
        '{command: he said "hi"}'
      );
      // The embedded double-quote is escaped into the JSON string rather than
      // breaking out (which previously produced invalid JSON and silently
      // degraded to {}). The data now survives and the field is marked unquoted.
      expect(value).toEqual({ command: 'he said "hi"' });
      expect(unquotedFields).toEqual({ command: true });
      expect(errorSpy).not.toHaveBeenCalled();
    }
  );

  it("converts a single-quoted value to a double-quoted string (line 85)", () => {
    const { value } = parseJsonWithUnquoted("{command: 'foo'}");
    expect(value).toEqual({ command: "foo" });
  });

  it("escapes embedded double-quotes when converting a single-quoted value (line 85)", () => {
    const { value } = parseJsonWithUnquoted("{command: 'say \"hi\"'}");
    expect(value).toEqual({ command: 'say "hi"' });
  });

  it(
    "marks a single-quoted value as unquoted, like a bare unquoted value " +
      "(Notidian-d4u defect 3)",
    () => {
      // The single-quoted-value branch now sets unquotedFields[cleanKey] = true,
      // matching the bare-value path, so single-quoting a value preserves the
      // round-trip marker.
      const { unquotedFields } = parseJsonWithUnquoted("{command: 'foo'}");
      expect(unquotedFields).toEqual({ command: true });
    }
  );

  it("handles a backslash inside a single-quoted value without throwing", () => {
    const { value } = parseJsonWithUnquoted("{command: 'a\\\\b'}");
    // Captures current behavior: the escaped backslash survives JSON.parse.
    expect(value).toEqual({ command: "a\\b" });
  });

  it("a stray closing brace inside a value defeats the regex and degrades to {} (line 53)", () => {
    // /(\w+)\s*:\s*([^,}\]]+)/ stops the value at the first '}', producing
    // unbalanced JSON; the aggressive fallback cannot recover it either.
    const { value } = parseJsonWithUnquoted("{command: a}b}");
    expect(value).toEqual({});
    expect(errorSpy).toHaveBeenCalled();
  });

  it("a stray closing bracket inside a value defeats the regex and degrades to {} (line 53)", () => {
    const { value } = parseJsonWithUnquoted("{command: a]b}");
    expect(value).toEqual({});
    expect(errorSpy).toHaveBeenCalled();
  });

  it("never returns a non-object/non-null shape for adversarial inputs", () => {
    const adversarial = [
      '{command: x", evil: "y}',
      '{a: }{}{',
      "{: novalue}",
      '{"a": "b" "c": "d"}',
      "{a: 'unterminated",
    ];
    for (const input of adversarial) {
      const { value } = parseJsonWithUnquoted(input);
      // Either a parsed object/value or the {} sentinel — never undefined, never a throw.
      expect(value === null || typeof value === "object" || typeof value === "string").toBe(
        true
      );
    }
  });
});

describe("parseJsonWithUnquoted — tolerant tokenizer (ADR 0026 2a, hardenFrameExecution)", () => {
  // The tokenizer path is gated ON only under hardenFrameExecution (the existing
  // default-OFF vke frame-execution flag). With the flag OFF the legacy regex
  // behavior is byte-for-byte preserved; with it ON, values containing embedded
  // ,/}/] are recovered instead of silently degrading the whole object to {}.

  it("OFF (default): a stray '}' inside a value still degrades to {} (legacy preserved)", () => {
    const { value } = parseJsonWithUnquoted("{command: a}b}");
    expect(value).toEqual({});
    expect(errorSpy).toHaveBeenCalled();
  });

  it("ON: recovers a value containing a stray '}' instead of degrading to {}", () => {
    const { value, unquotedFields } = parseJsonWithUnquoted("{command: a}b}", true);
    expect(value).toEqual({ command: "a}b" });
    expect(unquotedFields).toEqual({ command: true });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("OFF (default): a stray ']' inside a value still degrades to {} (legacy preserved)", () => {
    const { value } = parseJsonWithUnquoted("{command: a]b}");
    expect(value).toEqual({});
    expect(errorSpy).toHaveBeenCalled();
  });

  it("ON: recovers a value containing a stray ']' instead of degrading to {}", () => {
    const { value, unquotedFields } = parseJsonWithUnquoted("{command: a]b}", true);
    expect(value).toEqual({ command: "a]b" });
    expect(unquotedFields).toEqual({ command: true });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("ON: does NOT split a value on a comma that lives inside a single-quoted string", () => {
    // The legacy regex would truncate at the comma; the tokenizer is string-aware.
    const { value } = parseJsonWithUnquoted("{command: 'a, b', other: c}", true);
    expect(value).toEqual({ command: "a, b", other: "c" });
  });

  it("ON: keeps a nested object value whole (embedded braces do not truncate it)", () => {
    const { value } = parseJsonWithUnquoted(
      '{command: foo, parameters: {"a": 1, "b": 2}}',
      true
    );
    expect(value).toEqual({ command: "foo", parameters: { a: 1, b: 2 } });
    // Only the bare command is marked unquoted; the JSON-literal object value is not.
    // (parameters is a valid JSON object literal, so it stays typed.)
  });

  it("ON: keeps a nested array value whole (embedded brackets/commas do not truncate)", () => {
    const { value } = parseJsonWithUnquoted(
      '{command: foo, parameters: [1, 2, 3]}',
      true
    );
    expect(value).toEqual({ command: "foo", parameters: [1, 2, 3] });
  });

  it("ON: still escapes an embedded double-quote (does not break out of the string)", () => {
    const { value, unquotedFields } = parseJsonWithUnquoted(
      '{command: he said "hi", other: x}',
      true
    );
    expect(value).toEqual({ command: 'he said "hi"', other: "x" });
    expect(unquotedFields).toEqual({ command: true, other: true });
  });

  it(
    "ON: ADVERSARIAL — a quote-breakout attempt does NOT pollute the object; " +
      "the injected key never leaks (injection contract preserved under the tokenizer)",
    () => {
      // Crafted to close the string and inject a sibling key. The tokenizer must
      // never emit a polluted object. The embedded double-quote is escaped into
      // the value, so 'injected' becomes part of the command string, not a key.
      const { value } = parseJsonWithUnquoted('{command: x", "injected": "y}', true);
      expect(value).not.toHaveProperty("injected");
      expect(typeof value === "object" && value !== null).toBe(true);
    }
  );

  it("ON: never emits invalid JSON / never throws for an adversarial corpus", () => {
    const adversarial = [
      '{command: x", evil: "y}',
      '{a: }{}{',
      "{: novalue}",
      '{"a": "b" "c": "d"}',
      "{a: 'unterminated",
      "{command: a}b}",
      "{command: a]b}",
      "{deeply: {nested: {a: 1, b: [2, 3]}}}",
      "{trailing: x,}",
    ];
    for (const input of adversarial) {
      const { value } = parseJsonWithUnquoted(input, true);
      // Either a parsed object/value or the {} sentinel — never undefined, never a throw.
      expect(
        value === null || typeof value === "object" || typeof value === "string"
      ).toBe(true);
    }
  });

  it("ON: an unbalanced payload bails to the legacy fallback (no invented shape)", () => {
    // Unterminated string -> tokenizer returns null -> legacy path -> {} sentinel.
    const { value } = parseJsonWithUnquoted("{command: 'unterminated", true);
    expect(value === null || typeof value === "object").toBe(true);
  });

  it("ON: a well-formed pure-JSON object is unaffected (fast-path still wins)", () => {
    // hardenFrameExecution does not change the JSON fast-path; only the fallback.
    const { value, unquotedFields } = parseJsonWithUnquoted('{"a":1,"b":"x"}', true);
    expect(value).toEqual({ a: 1, b: "x" });
    expect(unquotedFields).toEqual({});
  });

  it("ON: tolerates a trailing comma without degrading", () => {
    const { value } = parseJsonWithUnquoted("{command: foo, other: bar,}", true);
    expect(value).toEqual({ command: "foo", other: "bar" });
  });
});

describe("stringifyJsonWithUnquoted — basics + boundary", () => {
  it("returns 'null' for null/undefined (line 132)", () => {
    expect(stringifyJsonWithUnquoted(null)).toBe("null");
    expect(stringifyJsonWithUnquoted(undefined)).toBe("null");
  });

  it("returns standard JSON when no unquoted fields are specified (line 140)", () => {
    expect(stringifyJsonWithUnquoted({ command: "foo" })).toBe('{"command":"foo"}');
    expect(stringifyJsonWithUnquoted({ command: "foo" }, {})).toBe('{"command":"foo"}');
  });

  it("ignores falsy markers (shouldUnquote === false, line 146)", () => {
    expect(stringifyJsonWithUnquoted({ command: "$x" }, { command: false })).toBe(
      '{"command":"$x"}'
    );
  });

  it("honors the space argument like JSON.stringify", () => {
    expect(stringifyJsonWithUnquoted({ a: 1, b: 2 }, {}, 2)).toBe(
      '{\n  "a": 1,\n  "b": 2\n}'
    );
  });

  it("keeps a PLAIN string quoted even when its field is flagged unquoted (line 166-168)", () => {
    // Only $-/`-/${-prefixed values are emitted unquoted; ordinary strings stay quoted.
    expect(stringifyJsonWithUnquoted({ command: "foo" }, { command: true })).toBe(
      '{"command":"foo"}'
    );
  });

  it("emits $-expression values UNQUOTED when flagged (line 166)", () => {
    expect(stringifyJsonWithUnquoted({ command: "$abc" }, { command: true })).toBe(
      '{"command": $abc}'
    );
  });

  it("emits backtick template-literal values UNQUOTED when flagged (line 167)", () => {
    expect(stringifyJsonWithUnquoted({ command: "`tpl`" }, { command: true })).toBe(
      '{"command": `tpl`}'
    );
  });

  it("emits embedded ${...} template-expression values UNQUOTED when flagged (line 168)", () => {
    expect(stringifyJsonWithUnquoted({ command: "hi ${name}" }, { command: true })).toBe(
      '{"command": hi ${name}}'
    );
  });

  it("emits a one-level nested $-expression unquoted (lines 179-201)", () => {
    expect(
      stringifyJsonWithUnquoted({ parameters: { x: "$y" } }, { "parameters.x": true })
    ).toBe('{"parameters":{"x":$y}}');
  });

  it("leaves non-string flagged fields untouched (typeof guard, line 156)", () => {
    expect(stringifyJsonWithUnquoted({ count: 5 }, { count: true })).toBe('{"count":5}');
  });
});

describe("ROUND-TRIP property: stringify -> parse", () => {
  it("a pure-data command object round-trips losslessly via the JSON fast-path", () => {
    const obj = { command: "spaces://x", parameters: { a: "1", b: "2" } };
    const str = stringifyJsonWithUnquoted(obj, { command: true, parameters: true });
    const { value } = parseJsonWithUnquoted(str);
    expect(value).toEqual(obj);
  });

  it("a plain-string flagged field round-trips its VALUE losslessly", () => {
    const obj = { command: "foo" };
    const str = stringifyJsonWithUnquoted(obj, { command: true });
    const { value } = parseJsonWithUnquoted(str);
    expect(value).toEqual(obj);
  });

  it("a $-expression value round-trips its VALUE (string) through the unquoted path", () => {
    const obj = { command: "$abc" };
    const str = stringifyJsonWithUnquoted(obj, { command: true });
    expect(str).toBe('{"command": $abc}');
    const { value } = parseJsonWithUnquoted(str);
    // The VALUE survives (re-quoted to a string on the way back in).
    expect(value).toEqual({ command: "$abc" });
  });

  it(
    "preserves the UNQUOTED MARKER on the $-expression round-trip so a " +
      "re-stringify keeps the expression unquoted (Notidian-d4u defect 1)",
    () => {
      const obj = { command: "$abc" };
      const str = stringifyJsonWithUnquoted(obj, { command: true });
      const { value, unquotedFields } = parseJsonWithUnquoted(str);
      // Re-parsing '{"command": $abc}' goes through the aggressive fallback (the
      // key is already quoted, so the primary key:value regex never matches it).
      // That fallback now records the field it quotes, so the unquoted intent
      // survives the round-trip (defect 1 fixed).
      expect(value).toEqual({ command: "$abc" });
      expect(unquotedFields).toEqual({ command: true });
      // And a full round-trip is now idempotent: re-stringify reproduces the
      // unquoted expression rather than re-quoting it.
      expect(stringifyJsonWithUnquoted(value, unquotedFields)).toBe(str);
    }
  );

  it(
    "preserves $-expression/bare values under non-word keys (hyphen, dot) " +
      "in the aggressive fallback — never degrades to {} (Notidian-d4u defect 1 regression)",
    () => {
      // The aggressive fallback's value-quoting regex must match ANY quoted key,
      // not just barewords. Hyphen/dot/space keys are valid JSON and realistic
      // command/frame parameter names; narrowing the key class to \w+ silently
      // dropped their unquoted values and degraded the whole object to {}.
      const cases: Array<[string, Record<string, any>, Record<string, boolean>]> = [
        ['{"my-key": $abc}', { "my-key": "$abc" }, { "my-key": true }],
        ['{"content-type": $h}', { "content-type": "$h" }, { "content-type": true }],
        ['{"my.key": $abc}', { "my.key": "$abc" }, { "my.key": true }],
        ['{"api-key": user.token}', { "api-key": "user.token" }, { "api-key": true }],
      ];
      for (const [input, expectedValue, expectedMarkers] of cases) {
        const { value, unquotedFields } = parseJsonWithUnquoted(input);
        expect(value).toEqual(expectedValue);
        expect(unquotedFields).toEqual(expectedMarkers);
      }
    }
  );

  it(
    "keeps a mixed word/non-word-key $-expression object intact and " +
      "does not quote real JSON literals (Notidian-d4u defect 1)",
    () => {
      const { value, unquotedFields } = parseJsonWithUnquoted(
        '{"command": $abc, "api-key": $h, "n": 5, "ok": true}'
      );
      expect(value).toEqual({
        command: "$abc",
        "api-key": "$h",
        n: 5,
        ok: true,
      });
      // Only the two unquoted $-expression fields are marked; the literals are not.
      expect(unquotedFields).toEqual({ command: true, "api-key": true });
    }
  );

  it("a fast-path round-trip preserves arrays and nested objects exactly", () => {
    const obj = { command: "c", parameters: { list: [1, 2, 3], nested: { k: "v" } } };
    const str = stringifyJsonWithUnquoted(obj, {});
    const { value } = parseJsonWithUnquoted(str);
    expect(value).toEqual(obj);
  });

  it("the JSON fast-path is lossless for a spread of value types (line 25)", () => {
    const samples: any[] = [
      { s: "string", n: 1.5, b: false, z: null, arr: [], obj: {} },
      { unicode: "héllo — emoji 😀" },
      { withSpecials: "a\tb\nc" },
      { nested: { deep: { deeper: { x: 1 } } } },
    ];
    for (const sample of samples) {
      const { value } = parseJsonWithUnquoted(JSON.stringify(sample));
      expect(value).toEqual(sample);
    }
  });
});

describe("detectUnquotedFields — nested-path correctness (line 237)", () => {
  it("flags $-vars, backticks, ${} templates, property-access, and function calls", () => {
    expect(
      detectUnquotedFields({
        a: "$x", // variable reference
        b: "plain", // ordinary string -> not flagged
        c: "`tpl`", // template literal
        d: "a.b", // property access
        e: "fn()", // function call
        f: "hi ${name}", // template expression
      })
    ).toEqual({ a: true, c: true, d: true, e: true, f: true });
  });

  it("uses dotted paths for nested object values", () => {
    expect(detectUnquotedFields({ outer: { inner: "$x", plain: "y" } })).toEqual({
      "outer.inner": true,
    });
  });

  it("recurses arbitrarily deep with correct dotted paths", () => {
    expect(detectUnquotedFields({ a: { b: { c: "$deep" } } })).toEqual({
      "a.b.c": true,
    });
  });

  it("returns {} for non-object input (null/undefined/primitive, line 240)", () => {
    expect(detectUnquotedFields(null)).toEqual({});
    expect(detectUnquotedFields(undefined)).toEqual({});
    expect(detectUnquotedFields(42)).toEqual({});
    expect(detectUnquotedFields("$x")).toEqual({});
  });

  it("ignores number/boolean/null leaf values", () => {
    expect(detectUnquotedFields({ n: 1, b: true, z: null })).toEqual({});
  });
});

describe("mergeUnquotedFields — truthy-only union (line 215)", () => {
  it("keeps only truthy markers and unions across objects", () => {
    expect(
      mergeUnquotedFields({ a: true, b: false }, { c: true }, { a: false })
    ).toEqual({ a: true, c: true });
  });

  it("skips null/undefined object arguments without throwing (line 221)", () => {
    expect(
      mergeUnquotedFields({ a: true }, undefined as any, null as any, { b: true })
    ).toEqual({ a: true, b: true });
  });

  it("returns {} for no arguments", () => {
    expect(mergeUnquotedFields()).toEqual({});
  });
});

describe("wrapQuotes / unwrapQuotes", () => {
  it("wraps a plain value in single quotes", () => {
    expect(wrapQuotes("foo")).toBe("'foo'");
  });

  it("returns \"''\" for an empty/falsy value (line 270)", () => {
    expect(wrapQuotes("")).toBe("''");
    expect(wrapQuotes(undefined as any)).toBe("''");
  });

  it("does not double-wrap an already single/double/backtick wrapped value (line 273-277)", () => {
    expect(wrapQuotes("'foo'")).toBe("'foo'");
    expect(wrapQuotes('"foo"')).toBe('"foo"');
    expect(wrapQuotes("`foo`")).toBe("`foo`");
  });

  it("unwraps single/double/backtick wrapping (line 292-294)", () => {
    expect(unwrapQuotes("'foo'")).toBe("foo");
    expect(unwrapQuotes('"foo"')).toBe("foo");
    expect(unwrapQuotes("`foo`")).toBe("foo");
  });

  it("returns the value unchanged when not wrapped", () => {
    expect(unwrapQuotes("foo")).toBe("foo");
  });

  it("returns '' for an empty/falsy value (line 289)", () => {
    expect(unwrapQuotes("")).toBe("");
    expect(unwrapQuotes(undefined as any)).toBe("");
  });

  it("unwrap(wrap(x)) === x for values WITHOUT embedded quotes (inverse property)", () => {
    for (const x of ["foo", "spaces://abc", "a b c", "123", "$ref"]) {
      expect(unwrapQuotes(wrapQuotes(x))).toBe(x);
    }
  });

  it(
    "wrap/unwrap is a true inverse for values containing a single quote " +
      "(Notidian-d4u defect 4)",
    () => {
      // wrapQuotes("it's") => "'it\\'s'"; unwrapQuotes now reverses the line-281
      // escaping (\\' -> ') instead of only stripping the outer quotes, so the
      // two are genuine inverses.
      const wrapped = wrapQuotes("it's");
      expect(wrapped).toBe("'it\\'s'");
      expect(unwrapQuotes(wrapped)).toBe("it's");
    }
  );

  it("unwrap(wrap(x)) === x for values WITH embedded single quotes (inverse property)", () => {
    // Note: a value that is ALREADY quote-wrapped (e.g. "''") is short-circuited
    // by wrapQuotes and is intentionally outside this inverse contract.
    for (const x of ["it's", "y'all can't", "a'", "'b", "don't $ref"]) {
      expect(unwrapQuotes(wrapQuotes(x))).toBe(x);
    }
  });
});
