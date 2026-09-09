interface LogoMarkProps {
  className?: string;
}

/**
 * Marca da Oficina do Smartphone: um cubo com o celular numa face e as
 * ferramentas na outra — sem fundo, herda a cor do texto (currentColor),
 * para funcionar tanto na sidebar escura quanto no card claro do login.
 */
export function LogoMark({ className }: LogoMarkProps) {
  return (
    <svg viewBox="0 0 100 100" fill="none" className={className} aria-hidden="true">
      <polygon
        points="50,6 92,29 92,71 50,94 8,71 8,29"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <polyline points="8,29 50,50 92,29" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" />
      <line x1="50" y1="50" x2="50" y2="94" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />

      {/* celular, face esquerda */}
      <rect x="20" y="46" width="19" height="29" rx="3" stroke="currentColor" strokeWidth="3.2" />
      <line x1="25.5" y1="51.5" x2="33.5" y2="51.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="29.5" cy="69" r="1.8" fill="currentColor" />

      {/* chave inglesa + chave de fenda, face direita */}
      <line x1="59" y1="75" x2="81" y2="47" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round" />
      <circle cx="81" cy="45" r="5.5" stroke="currentColor" strokeWidth="3.2" />
      <line x1="61" y1="47" x2="83" y2="75" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round" />
      <rect
        x="57"
        y="42"
        width="7"
        height="10"
        rx="1.6"
        transform="rotate(-40 60.5 47)"
        fill="currentColor"
      />
    </svg>
  );
}