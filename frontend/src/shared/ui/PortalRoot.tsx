import { createContext, use, useState, type ReactNode } from 'react';

const PortalContext = createContext<HTMLElement | null | undefined>(undefined);

export function PortalRoot({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  return (
    <PortalContext value={node}>
      {children}
      <div ref={setNode} />
    </PortalContext>
  );
}

export function usePortalTarget(): HTMLElement | null {
  const node = use(PortalContext);
  return node === undefined ? document.body : node;
}
