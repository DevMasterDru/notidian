import React, { FormEvent, useEffect, useRef, useState } from "react";

export const CommentModal = (props: {
  saveComment: (body: string) => Promise<boolean>;
  hide?: () => void;
}) => {
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const normalizedBody = body.trim();

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!normalizedBody || submitting) return;

    setSubmitting(true);
    const saved = await props.saveComment(normalizedBody);
    if (saved) {
      props.hide?.();
      return;
    }
    setSubmitting(false);
  };

  return (
    <form className="mk-layout-column mk-gap-8" onSubmit={submit}>
      <textarea
        ref={textareaRef}
        aria-label="Comment"
        className="mk-input mk-input-large mk-comment-body"
        rows={5}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        style={{ width: "100%", resize: "vertical" }}
      />
      <div className="mk-modal-actions">
        <button
          className="mk-comment-submit"
          type="submit"
          disabled={!normalizedBody || submitting}
        >
          {submitting ? "Adding…" : "Add comment"}
        </button>
        <button type="button" onClick={() => props.hide?.()}>
          Cancel
        </button>
      </div>
    </form>
  );
};
