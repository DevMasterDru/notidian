import type * as math from "mathjs"
import { IndexMap } from "shared/types/indexMap"

let _mathjs: typeof math | null = null;
function getMathJs(): typeof math {
	if (!_mathjs) _mathjs = require("mathjs") as typeof math;
	return _mathjs;
}
import { DBRow, SpaceProperty } from "shared/types/mdb"
import { PathState } from "shared/types/PathState"
import { parseProperty } from "utils/parsers"
import { formulas } from "./formulas"


export function compact<T>(arr: T[]): NonNullable<T>[] {
	return arr.filter(Boolean) as NonNullable<T>[]
}

export function unreachable(never: never): never {
	throw new Error(`Expected value to never occur: ${JSON.stringify(never)}`)
}





export type FormulaFunctionNode = {
	type: "function"
	name: string
	args: FormulaNode[]
}

export type FormulaPropertyNode = {
	type: "property"
	name: string
	propertyType: string
}

export type FormulaLiteralNode = {
	type: "literal"
	value: string
}

export type FormulaParenthesesNode = {
	type: "parentheses"
	inner: FormulaNode
}

export type FormulaOperatorNode = {
	type: "operator"
	operator: string
	args: FormulaNode[]
}

export type FormulaConditionalNode = {
	type: "conditional"
	condition: FormulaNode
	ifTrue: FormulaNode
	ifFalse: FormulaNode
}

export type FormulaErrorNode = {
	type: "error"
	message: string
}

export type FormulaSymbolNode = {
	type: "symbol"
	name: string
}

export type FormulaNode =
	| FormulaFunctionNode
	| FormulaPropertyNode
	| FormulaLiteralNode
	| FormulaParenthesesNode
	| FormulaOperatorNode
	| FormulaConditionalNode
	| FormulaErrorNode
	| FormulaSymbolNode

type FormulaParserResult = {
	formula: FormulaNode | undefined
	errors: string[]
}


export function parseFormula(
	oldFormula: string,
	propMap: SpaceProperty[]
): FormulaParserResult {
	try {
		const mathNode = getMathJs().parse(oldFormula)
		const formulaNode = nodeToFormula(mathNode, propMap, [])
		return formulaNode
			? {
					formula: formulaNode,
					errors: [],
			}
			: {
					formula: undefined,
					errors: ["Could not parse formula 😭"],
            }
	} catch (e) {
		return {
			formula: undefined,
			errors: ["Could not parse formula 😭"],
		}
	}
}

function nodeToFormula(
	node: math.MathNode | undefined,
	propMap: SpaceProperty[],
	errors: string[]
): FormulaNode | undefined {
	if (!node) {
		return
	}
	if (
		node.type === "AccessorNode" ||
		node.type === "ArrayNode" ||
		node.type === "AssignmentNode" ||
		node.type === "BlockNode" ||
		node.type === "FunctionAssignmentNode" ||
		node.type === "IndexNode" ||
		node.type === "ObjectNode" ||
		node.type === "RangeNode"
	) {
		const error = {
			type: "error" as const,
			message: "Invalid syntax: " + node.toString(),
		}
		errors.push(error.message)
		return error
	} else if (node.type === "ConditionalNode") {
		const condition = nodeToFormula((node as math.ConditionalNode).condition, propMap, errors)
		const trueExpr = nodeToFormula((node as math.ConditionalNode).trueExpr, propMap, errors)
		const falseExpr = nodeToFormula((node as math.ConditionalNode).falseExpr, propMap, errors)
		if (!condition) {
			return
		}
		if (condition.type === "error") {
			return condition
		}
		if (trueExpr && trueExpr.type === "error") {
			return trueExpr
		}
		if (falseExpr && falseExpr.type === "error") {
			return falseExpr
		}
		if (!trueExpr || !falseExpr) {
			const error = {
				type: "error" as const,
				message: "Invalid conditional: " + node.toString(),
			}
			errors.push(error.message)
			return error
		}
		return {
			type: "conditional",
			condition,
			ifTrue: trueExpr,
			ifFalse: falseExpr,
		}
	} else if (node.type === "ConstantNode") {
		return {
			type: "literal",
			value:
				(typeof (node as math.ConstantNode).value === "string"
					? // Preserver \n, \" and \t for strings
					  `"${((node as math.ConstantNode).value as unknown as string)
							.replace(/\n/g, "\\n")
							.replace(/"/g, '\\"')
							.replace(/\t/g, "\\t")}"`
					: (node as math.ConstantNode).value) as string,
		}
	} else if (node.type === "FunctionNode") {
		const { fn, args } = node as math.FunctionNode
		if (fn.name === "prop") {
			if (args.length !== 1) {
				return {
					type: "error",
					message: "Too many arguments passed to prop().",
				}
			}
			const arg = args[0]
			if (arg.type !== "ConstantNode") {
				const error = {
					type: "error" as const,
					message: "Invalid property reference: " + arg.toString(),
				}
				errors.push(error.message)
				return error
			}
			const value = (arg as math.ConstantNode).value as unknown as string;
			return {
				type: "property",
				name: value,
				propertyType: propMap.find(f => f.name == value)?.type ?? "other",
			}
		}
		const functionArgs: FormulaNode[] = compact(
			(args || []).map(arg => nodeToFormula(arg, propMap, errors))
		)
		// Note: Does not check for invalid functions.
		return {
			type: "function",
			name: fn.name,
			args: functionArgs,
		}
	} else if (node.type === "OperatorNode") {
		const { op, args } = node as math.OperatorNode

		const functionArgs: FormulaNode[] = compact(
			(args || []).map(arg => nodeToFormula(arg, propMap, errors))
		)
		// Note: Does not check for invalid operators.
		return {
			type: "operator",
			operator: op,
			args: functionArgs,
		}
	} else if (node.type === "ParenthesisNode") {
		return nodeToFormula((node as math.ParenthesisNode).content, propMap, errors)
	} else if (node.type === "SymbolNode") {
		const { name } = node as math.SymbolNode
		if (["e", "pi", "true", "false"].includes(name)) {
			return {
				type: "symbol",
				name,
			}
		} else {
			const error = {
				type: "error" as const,
				message: "Undefined constant: " + name,
			}
			errors.push(error.message)
			return error
		}
	}
	return
}
export const runFormulaNode = (node: FormulaNode, propMap: DBRow): string => {
	const m = getMathJs();
	const all = {
		...m.all,
		createAdd: m.factory('add', [], () => function add (a: any, b: any) {
			return a + b
		  }),
		  createEqual: m.factory('equal', [], () => function equal (a: any, b: any) {
			return a == b
		  }),
		  createUnequal: m.factory('unequal', [], () => function unequal (a: any, b: any) {
			return a != b
		  })


	}
	const config :math.ConfigOptions = {
		matrix: "Array"
	}
	const runContext = m.create(all, config)
	runContext.import(formulas, { override: true })
	if (node.type === "literal") {
		return node.value
	} else if (node.type === "property") {
		return propMap[node.name] ?? ""
	} else if (node.type === "function") {
		const args = node.args.map(f => runFormulaNode(f, propMap))
		if (node.name === "prop") {
			return args[0]
		}
		return runContext.evaluate(`${node.name}(${args.join(",")})`)
	} else if (node.type === "operator") {
		const args = node.args.map(f => runFormulaNode(f, propMap))
		return runContext.evaluate(`${args.join(node.operator)}`)
	} else if (node.type === "conditional") {
		// The ': string' return signature is dishonest: a literal/operator/symbol
		// node can evaluate to a real JS boolean (verified by the "engine
		// boundaries" tests in parser.test.ts), so widen to `unknown` here to
		// compare against the actual runtime value.
		const condition: unknown = runFormulaNode(node.condition, propMap)
		// Accept BOTH the string "true" (string-literal/symbol path) and the JS
		// boolean `true` (a true/false keyword lowers to a mathjs ConstantNode →
		// literal node returning the verbatim boolean, and operator/symbol nodes
		// can also evaluate to a real boolean). Do NOT broaden to a truthy check —
		// that would change "false"/0/"" semantics; keep the exact-match contract.
		if (condition === "true" || condition === true) {
			return runFormulaNode(node.ifTrue, propMap)
		} else {
			return runFormulaNode(node.ifFalse, propMap)
		}
	} else if (node.type === "error") {
		return ""
	} else if (node.type === "symbol") {
		if (node.name === "true") {
			return "true"
		} else if (node.name === "false") {
			return "false"
		} else if (node.name === "pi") {
			return "3.141592653589793"
		} else if (node.name === "e") {
			return "2.718281828459045"
		}
	}
	return ""
}

export const runFormulaWithContext = (runContext: math.MathJsInstance, paths: Map<string, PathState>, spaceMap: IndexMap, formula: string, properties: {[key: string]: SpaceProperty}, values: {[key: string] : any}, path?: PathState, emitError?: boolean): string => {
	if (!formula) return ""
	
	const scope = new Map();
	Object.keys(values).forEach(f => scope.set(f, values[f]))
	scope.set("$properties", properties)
	scope.set("$paths", paths)
	scope.set("$items", spaceMap.invMap)
	scope.set("$spaces", spaceMap.map)
	if (path)
		scope.set("$current", path)
	let value;
	
	try {
		runContext.evaluate("current = _current()", scope)
		value = runContext.evaluate(formula, scope)
		value = parseProperty("", value)
		if (typeof value != "string") {
			if (emitError) throw(value)
		}
	} catch (e) {
		value = ""
		if (emitError) console.log(e)
	}
	return  value
}

// The former `runFormula` / `runExec` helpers were deleted (bd Notidian-y8qk):
// both had zero live callers and `runFormula` was a stale duplicate of
// runFormulaWithContext that re-did the math.create/factory/import setup and
// carried a latent bug — an EMPTY catch over an uninitialized `let value`, so a
// throwing formula returned `undefined` (not `''`) despite its `: string`
// signature. Every live formula path already calls `runFormulaWithContext`
// (which correctly sets `value = ''` in its catch); any future need for a
// scope-bound formula evaluation should reach for it, not a resurrected
// duplicate. A static guard in parser.deadHelpers.guard.test.ts keeps both
// symbols from coming back.

