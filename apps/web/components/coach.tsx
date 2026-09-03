/**
 * The tutor's bubble: one or two sentences, one action named in bold. The
 * primary button below it (wired by the caller) should mirror that action.
 */
export function Coach({ children }: { children: React.ReactNode }) {
  return (
    <div className="coach">
      <span className="avatar">T</span>
      <span>{children}</span>
    </div>
  );
}
