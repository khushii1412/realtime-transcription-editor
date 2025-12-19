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
                border: "1px solid rgba(255,255,255,0.2)",
                background: isActive ? "rgba(139, 92, 246, 0.3)" : "transparent",
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
                border: "1px solid rgba(255,255,255,0.2)",
                background: "transparent",
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
const Toolbar = ({ editor, onResetToLatest, showNewFinalBadge, isFinalDirty }) => {
    return (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                padding: "8px 12px",
                borderBottom: "1px solid rgba(255,255,255,0.1)",
                background: "rgba(0,0,0,0.15)",
                flexWrap: "wrap",
                gap: 4,
            }}
        >
            <MarkButton format="bold" label="B" />
            <MarkButton format="italic" label="I" />
            <MarkButton format="underline" label="U" />
            <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.1)", margin: "0 8px" }} />
            <HistoryButton type="undo" editor={editor} />
            <HistoryButton type="redo" editor={editor} />
            <div style={{ flex: 1 }} />
            {isFinalDirty && (
                <span style={{ fontSize: 11, color: "var(--color-warning)", marginRight: 8 }}>
                    Edited
                </span>
            )}
            {showNewFinalBadge && isFinalDirty && (
                <span style={{
                    fontSize: 10,
                    padding: "2px 6px",
                    borderRadius: 10,
                    background: "rgba(16, 185, 129, 0.2)",
                    color: "#10b981",
                    marginRight: 8,
                }}>
                    New update
                </span>
            )}
            <button
                type="button"
                onClick={onResetToLatest}
                disabled={!isFinalDirty && !showNewFinalBadge}
                style={{
                    padding: "4px 10px",
                    fontSize: 11,
                    borderRadius: 4,
                    border: "1px solid rgba(255,255,255,0.2)",
                    background: (isFinalDirty || showNewFinalBadge) ? "rgba(139, 92, 246, 0.2)" : "transparent",
                    color: (isFinalDirty || showNewFinalBadge) ? "var(--text-primary)" : "var(--text-muted)",
                    cursor: (isFinalDirty || showNewFinalBadge) ? "pointer" : "not-allowed",
                    opacity: (isFinalDirty || showNewFinalBadge) ? 1 : 0.5,
                }}
            >
                Use latest
            </button>
        </div>
    );
};

// ---------------------------
// Main FinalEditor Component
// ---------------------------
export default function FinalEditor({
    value,
    onChange,
    onUserEdit,
    onResetToLatest,
    showNewFinalBadge = false,
    isFinalDirty = false,
}) {
    const editor = useMemo(() => withHistory(withReact(createEditor())), []);
    const isFirstRender = useRef(true);
    const prevValueRef = useRef(null);

    // Sync editor content when parent value changes (only when NOT dirty)
    useEffect(() => {
        if (isFirstRender.current) {
            isFirstRender.current = false;
            prevValueRef.current = value;
            return;
        }
        if (!isFinalDirty && value) {
            const newText = value[0]?.children?.[0]?.text || "";
            const prevText = prevValueRef.current?.[0]?.children?.[0]?.text || "";
            if (newText !== prevText) {
                editor.children = value;
                editor.onChange();
            }
        }
        prevValueRef.current = value;
    }, [value, isFinalDirty, editor]);

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
            border: isFinalDirty ? "2px solid rgba(139, 92, 246, 0.5)" : "1px solid rgba(255,255,255,0.1)",
            borderRadius: 8,
            background: "rgba(0,0,0,0.2)",
            overflow: "hidden",
        }}>
            <Slate
                editor={editor}
                initialValue={value}
                onChange={(newValue) => {
                    onChange(newValue);
                    const isUserEdit = editor.operations.some(
                        op => op.type !== "set_selection" && op.type !== "set_mark"
                    );
                    if (isUserEdit && onUserEdit) {
                        onUserEdit();
                    }
                }}
            >
                <Toolbar
                    editor={editor}
                    onResetToLatest={onResetToLatest}
                    showNewFinalBadge={showNewFinalBadge}
                    isFinalDirty={isFinalDirty}
                />
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
