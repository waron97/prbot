// Empirically observed (not spec-confirmed — the Process Builder backend
// source isn't reachable) failure mode: a UserTask reached with
// errorCode === '' makes `GET .../variable` respond 400 ERR-SYM-007 and the
// page never opens, even though the underlying process stays 'in progress'.
// '0' is the corpus-wide convention for "no error" and does not trigger it.

function isSetVariableCall(node) {
    return (
        node.type === 'CallExpression' &&
        node.callee.type === 'MemberExpression' &&
        !node.callee.computed &&
        node.callee.object.type === 'Identifier' &&
        node.callee.object.name === 'execution' &&
        node.callee.property.type === 'Identifier' &&
        node.callee.property.name === 'setVariable'
    );
}

function isErrorCodeKey(node) {
    return node && node.type === 'Literal' && node.value === 'errorCode';
}

function isEmptyStringLiteral(node) {
    return node && node.type === 'Literal' && node.value === '';
}

function isFunctionNode(node) {
    return (
        node.type === 'FunctionDeclaration' ||
        node.type === 'FunctionExpression' ||
        node.type === 'ArrowFunctionExpression'
    );
}

function findEnclosingScope(node) {
    let cur = node.parent;
    while (cur) {
        if (isFunctionNode(cur) || cur.type === 'Program') return cur;
        cur = cur.parent;
    }
    return null;
}

// Lightweight intra-function trace: every assignment (declaration init or
// `=` assignment) to `name` within `scopeRoot`, not crossing into nested
// function bodies. No control-flow graph — a syntactic best effort, per the
// rule's documented limits.
function collectAssignments(scopeRoot, name) {
    const found = [];
    (function walk(node) {
        if (!node || typeof node.type !== 'string') return;
        if (node !== scopeRoot && isFunctionNode(node)) return;

        if (
            node.type === 'VariableDeclarator' &&
            node.id.type === 'Identifier' &&
            node.id.name === name &&
            node.init
        ) {
            found.push(node.init);
        }
        if (
            node.type === 'AssignmentExpression' &&
            node.operator === '=' &&
            node.left.type === 'Identifier' &&
            node.left.name === name
        ) {
            found.push(node.right);
        }

        for (const key of Object.keys(node)) {
            if (key === 'parent') continue;
            const child = node[key];
            if (Array.isArray(child)) {
                for (const c of child) walk(c);
            } else if (child && typeof child.type === 'string') {
                walk(child);
            }
        }
    })(scopeRoot);
    return found;
}

const rule = {
    meta: {
        type: 'problem',
        fixable: 'code',
        schema: [
            {
                type: 'object',
                properties: {
                    allowPotentiallyEmpty: { type: 'boolean' },
                },
                additionalProperties: false,
            },
        ],
        messages: {
            emptyLiteral:
                "execution.setVariable('errorCode', '') breaks the backend's variable read " +
                '(400 ERR-SYM-007 — the page never opens, though the process itself stays ' +
                "'in progress'). Use '0' for \"no error\" instead of ''.",
            potentiallyEmpty:
                "'{{name}}' is assigned '' on at least one path before being passed to " +
                "execution.setVariable('errorCode', {{name}}). If that path is taken at " +
                "runtime, the same 400 ERR-SYM-007 failure as a literal '' applies — use " +
                '\'0\' for "no error" on every path.',
        },
    },
    create(context) {
        const options = context.options[0] || {};
        const allowPotentiallyEmpty = options.allowPotentiallyEmpty === true;

        return {
            CallExpression(node) {
                if (!isSetVariableCall(node)) return;
                const [keyArg, valueArg] = node.arguments;
                if (!isErrorCodeKey(keyArg) || !valueArg) return;

                if (isEmptyStringLiteral(valueArg)) {
                    context.report({
                        node: valueArg,
                        messageId: 'emptyLiteral',
                        fix(fixer) {
                            return fixer.replaceText(valueArg, "'0'");
                        },
                    });
                    return;
                }

                if (allowPotentiallyEmpty || valueArg.type !== 'Identifier') return;

                const scopeRoot = findEnclosingScope(node);
                if (!scopeRoot) return;

                const assignments = collectAssignments(scopeRoot, valueArg.name);
                if (!assignments.length) return;

                const hasEmpty = assignments.some(isEmptyStringLiteral);
                const hasNonEmpty = assignments.some((a) => !isEmptyStringLiteral(a));
                if (hasEmpty && hasNonEmpty) {
                    context.report({
                        node: valueArg,
                        messageId: 'potentiallyEmpty',
                        data: { name: valueArg.name },
                    });
                }
            },
        };
    },
};

export default rule;
