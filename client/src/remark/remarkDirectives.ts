import type { Plugin } from 'unified';
import type { Content, Root } from 'mdast';

// Directive container types we recognize. Each maps to a GitHub alert
// variant so the existing `markdown-alert-*` CSS rules apply without
// duplicating styles.
const ALERT_TYPES = new Set(['note', 'tip', 'warning', 'danger', 'details']);

function capitalize(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
}

interface DirectiveNode {
    type: 'containerDirective';
    name: string;
    children: Content[];
}

function isDirectiveNode(node: unknown): node is DirectiveNode {
    if (!node || typeof node !== 'object') {
        return false;
    }
    const directive = node as { type?: string; name?: unknown };
    return (
        directive.type === 'containerDirective' &&
        typeof directive.name === 'string'
    );
}

function walk(node: { children?: unknown[] }): void {
    if (!Array.isArray(node.children)) {
        return;
    }
    for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        if (!child || typeof child !== 'object') {
            continue;
        }
        if (isDirectiveNode(child) && ALERT_TYPES.has(child.name)) {
            // Reuse the GitHub alert visual treatment by emitting a
            // blockquote with the matching className so existing CSS rules
            // render the icon and color without extra styling.
            const titleNode: Content = {
                type: 'paragraph',
                data: {
                    hProperties: {
                        className: `markdown-alert-title markdown-alert-${child.name}`,
                    },
                },
                children: [{ type: 'text', value: capitalize(child.name) }],
            } as unknown as Content;

            const blockquote: Content = {
                type: 'blockquote',
                data: {
                    hProperties: {
                        className: `markdown-alert markdown-alert-${child.name}`,
                    },
                },
                children: [titleNode, ...child.children],
            } as unknown as Content;

            node.children[i] = blockquote;
        } else {
            walk(child as { children?: unknown[] });
        }
    }
}

const remarkDirectives: Plugin<[], Root> = () => (root: Root) => {
    walk(root as unknown as { children?: unknown[] });
};

export default remarkDirectives;
