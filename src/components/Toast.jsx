export default function Toast({ msg }) {
  return (
    <div style={{
      position:'fixed', bottom:20, left:'50%', transform:'translateX(-50%)',
      background:'var(--surface2)', border:'1px solid var(--border)',
      color:'var(--text)', padding:'9px 18px', borderRadius:7,
      fontSize:12, zIndex:9999, pointerEvents:'none',
      animation:'tin .2s ease',
    }}>
      <style>{`@keyframes tin{from{opacity:0;transform:translateX(-50%) translateY(8px);}to{opacity:1;transform:translateX(-50%) translateY(0);}}`}</style>
      {msg}
    </div>
  );
}
