/**
 * FinalEditor.jsx - Slate Rich Text Editor for Final Transcript
 * 
 * Features:
 * - Bold / Italic / Underline formatting
 * - Undo / Redo with slate-history
 * - Keyboard shortcuts (Cmd/Ctrl+B/I/U, Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z)
 */
import React, { useCallback, useMemo, useRef, useEffect } from "react";
import { createEditor, Editor, Transforms } from "slate";
import { Slate, Editable, withReact, useSlate } from "slate-react";
import { withHistory } from "slate-history";

// ---------------------------
// Mark Toggle Helpers
// ---------------------------
const isMarkActive = (editor, format) => {
    const marks = Editor.marks(editor);
    return marks ? marks[format] === true : false;
};

const toggleMark = (editor, format) => {
    const isActive = isMarkActive(editor, format);
    if (isActive) {
        Editor.removeMark(editor, format);
    } else {
        Editor.addMark(editor, format, true);
    }
};

// ---------------------------
// Leaf Renderer (handles bold/italic/underline)
// ---------------------------
const Leaf = ({ attributes, children, leaf }) => {
    if (leaf.bold) {
        children = <strong>{children}</strong>;
    }
    if (leaf.italic) {
        children = <em>{children}</em>;
    }
    if (leaf.underline) {
        children = <u>{children}</u>;
    }
    return <span {...attributes}>{children}</span>;
};

// ---------------------------
// Element Renderer (paragraph)
// ---------------------------
const Element = ({ attributes, children }) => {
    return <p {...attributes} style={{ margin: "0 0 0.5em 0" }}>{children}</p>;
};

// ---------------------------
// Toolbar Button
// ---------------------------
const MarkButton = ({ format, label }) => {
    const editor = useSlate();
    const isActive = isMarkActive(editor, format);
    return (
        <button
            type="button"
            onMouseDown={(e) => {
                e.preventDefault();
                toggleMark(editor, format);
            }}
            style={{
                padding: "4px 8px",
                marginRight: 4,
                borderRadius: 4,
                border: "1px solid var(--border-default)",
                background: isActive ? "rgba(139, 92, 246, 0.3)" : "var(--surface-secondary)",
                color: isActive ? "var(--text-primary)" : "var(--text-muted)",
                cursor: "pointer",
                fontWeight: format === "bold" ? "bold" : "normal",
                fontStyle: format === "italic" ? "italic" : "normal",
                textDecoration: format === "underline" ? "underline" : "none",
                fontSize: 12,
            }}
        >
            {label}
        </button>
    );
};

// ---------------------------
// History Button (Undo/Redo)
// ---------------------------
const HistoryButton = ({ type, editor }) => {
    const handleClick = () => {
        if (type === "undo") {
            editor.undo();
        } else {
            editor.redo();
        }
    };
    return (
        <button
            type="button"
            onMouseDown={(e) => {
                e.preventDefault();
                handleClick();
            }}
            style={{
                padding: "4px 8px",
                marginRight: 4,
                borderRadius: 4,
                border: "1px solid var(--border-default)",
                background: "var(--surface-secondary)",
                color: "var(--text-muted)",
                cursor: "pointer",
                fontSize: 11,
            }}
        >
            {type === "undo" ? "↩ Undo" : "↪ Redo"}
        </button>
    );
};

// ---------------------------
// Toolbar Component
// ---------------------------
const Toolbar = ({ editor }) => {
    return (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                padding: "8px 12px",
                borderBottom: "1px solid var(--border-subtle)",
                background: "var(--surface-secondary)",
                flexWrap: "wrap",
                gap: 4,
            }}
        >
            <MarkButton format="bold" label="B" />
            <MarkButton format="italic" label="I" />
            <MarkButton format="underline" label="U" />
            <div style={{ width: 1, height: 20, background: "var(--border-subtle)", margin: "0 8px" }} />
            <HistoryButton type="undo" editor={editor} />
            <HistoryButton type="redo" editor={editor} />
        </div>
    );
};

// ---------------------------
// Main FinalEditor Component
// ---------------------------
export default function FinalEditor({
    value,
    onChange,
}) {
    const editor = useMemo(() => withHistory(withReact(createEditor())), []);
    const isFirstRender = useRef(true);
    const prevValueRef = useRef(null);
    const isInternalChangeRef = useRef(false); // Track if change came from user typing

    // Sync editor content when parent value changes
    // This handles loading saved content and appending new ASR text
    useEffect(() => {
        // Skip sync if change came from user editing (internal change)
        if (isInternalChangeRef.current) {
            isInternalChangeRef.current = false;
            prevValueRef.current = value;
            return;
        }

        if (isFirstRender.current) {
            isFirstRender.current = false;
            prevValueRef.current = value;
            // On first render, set editor content directly
            if (value && Array.isArray(value)) {
                editor.children = value;
                editor.selection = null;
                editor.onChange();
            }
            return;
        }

        if (!value || !Array.isArray(value)) return;

        // Helper to extract plain text from Slate value
        const getPlainText = (slateValue) => {
            if (!slateValue || !Array.isArray(slateValue)) return "";
            return slateValue
                .map(node => node.children?.map(c => c.text || "").join("") || "")
                .join("\n");
        };

        // Compare using full JSON to detect any structural changes
        const newJson = JSON.stringify(value);
        const prevJson = JSON.stringify(prevValueRef.current);

        if (newJson !== prevJson) {
            // Get plain text for smart append logic
            const newText = getPlainText(value);
            const currentEditorText = getPlainText(editor.children);

            // If new text is appending to current (ASR update), try smart append
            if (currentEditorText && newText.startsWith(currentEditorText) && newText.length > currentEditorText.length) {
                // Calculate delta
                const delta = newText.slice(currentEditorText.length);

                // Append delta at the end
                const lastParagraphIndex = editor.children.length - 1;
                const lastParagraph = editor.children[lastParagraphIndex];
                if (lastParagraph && lastParagraph.children && lastParagraph.children.length > 0) {
                    const lastLeafIndex = lastParagraph.children.length - 1;
                    const lastLeaf = lastParagraph.children[lastLeafIndex];
                    const offset = lastLeaf?.text?.length || 0;

                    try {
                        Transforms.insertText(editor, delta, {
                            at: { path: [lastParagraphIndex, lastLeafIndex], offset: offset }
                        });
                    } catch (e) {
                        // Fallback: replace entire content
                        console.warn("[FinalEditor] Append failed, replacing content:", e);
                        editor.children = value;
                        editor.selection = null;
                        editor.onChange();
                    }
                }
            } else {
                // Content changed significantly (e.g. loading from DB) - replace entirely
                editor.children = value;
                editor.selection = null;
                editor.onChange();
            }
        }
        prevValueRef.current = value;
    }, [value, editor]);

    const renderLeaf = useCallback((props) => <Leaf {...props} />, []);
    const renderElement = useCallback((props) => <Element {...props} />, []);

    const handleKeyDown = useCallback((event) => {
        if (!event.ctrlKey && !event.metaKey) return;
        switch (event.key.toLowerCase()) {
            case "b":
                event.preventDefault();
                toggleMark(editor, "bold");
                break;
            case "i":
                event.preventDefault();
                toggleMark(editor, "italic");
                break;
            case "u":
                event.preventDefault();
                toggleMark(editor, "underline");
                break;
            case "z":
                event.preventDefault();
                if (event.shiftKey) {
                    editor.redo();
                } else {
                    editor.undo();
                }
                break;
            default:
                break;
        }
    }, [editor]);

    return (
        <div style={{
            border: "1px solid var(--border-subtle)",
            borderRadius: 8,
            background: "var(--editor-bg, #ffffff)",
            overflow: "hidden",
        }}>
            <Slate
                editor={editor}
                initialValue={value}
                onChange={(newValue) => {
                    // Mark this as an internal change so useEffect skips syncing
                    isInternalChangeRef.current = true;
                    onChange(newValue);
                }}
            >
                <Toolbar editor={editor} />
                <Editable
                    renderLeaf={renderLeaf}
                    renderElement={renderElement}
                    onKeyDown={handleKeyDown}
                    placeholder="Final transcript will appear here. You can edit and format it."
                    style={{
                        padding: 12,
                        minHeight: 100,
                        color: "var(--text-primary)",
                        fontSize: 14,
                        lineHeight: 1.6,
                        outline: "none",
                    }}
                />
            </Slate>
        </div>
    );
}
