/* ══════════════════════════════════════
   Modal
   - overlay 클릭으로 닫기 선택 가능
   - maxWidth 조절 가능
══════════════════════════════════════ */
export default function Modal({ onClose, closeOnOverlay = true, maxWidth = 420, children }) {
  return (
    <div className="overlay" onClick={closeOnOverlay ? onClose : undefined}>
      <div className="modal" style={{ maxWidth }} onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
