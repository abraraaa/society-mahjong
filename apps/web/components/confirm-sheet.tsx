'use client';

/**
 * A bottom sheet with one question and two answers. The scrim is the second "no". `extras` are quieter answers
 * besides those two, each drawn above the "no", such as the host's "End the game for everyone" in the Leave sheet.
 *
 * It opens on the top layer, over whatever sheet the table already has up (the result sheet, a claim, the exchange),
 * and its scrim dims that sheet too, so nothing under the question can be tapped until it's answered. It always shows
 * whole, its answers with it, even on a phone lying down (`sheet-ask` in globals.css).
 */
export function ConfirmSheet({
  title,
  body,
  confirmLabel,
  cancelLabel = 'Stay',
  busy,
  extras,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  extras?: readonly { readonly label: string; readonly onClick: () => void }[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      <div className="scrim scrim-top" onClick={onCancel} />
      <div className="sheet sheet-top sheet-ask" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <div className="grabber" />
        <h2 id="confirm-title" className="font-display mb-2 text-xl">
          {title}
        </h2>
        <p className="ask-body text-ivory-200/70 mb-5 text-sm leading-snug">{body}</p>
        <div className="answers flex flex-col gap-2">
          <button type="button" className="btn btn-primary btn-block" onClick={onConfirm} disabled={busy}>
            {busy ? 'One moment…' : confirmLabel}
          </button>
          {extras?.map((x) => (
            <button key={x.label} type="button" className="btn btn-quiet btn-block" onClick={x.onClick} disabled={busy}>
              {x.label}
            </button>
          ))}
          <button type="button" className="btn btn-quiet btn-block" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
        </div>
      </div>
    </>
  );
}
