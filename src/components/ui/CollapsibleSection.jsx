import { useState } from 'react';

export default function CollapsibleSection({ label, color, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <div
        style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 8px', margin:'4px 0 2px', cursor:'pointer' }}
        onClick={() => setOpen(o => !o)}
      >
        <div style={{ flex:1, height:1, background:color, opacity:.4 }} />
        <span style={{ fontSize:11, color, fontWeight:700, whiteSpace:'nowrap' }}>{label}</span>
        <span style={{ fontSize:10, color, opacity:.7 }}>{open ? '▲' : '▼'}</span>
        <div style={{ flex:1, height:1, background:color, opacity:.4 }} />
      </div>
      {open && children}
    </div>
  );
}
