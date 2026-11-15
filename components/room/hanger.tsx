/* ============================================================
   شماعة خشب — إكسسوار مرسوم، مش جزء من صورة المنتج
   ------------------------------------------------------------
   القطعة نفسها صورة حقيقية مقصوصة، والشماعة بتترسم وراها عشان
   كل بكسل من المنتج يفضل زي ما هو. الخطاف المعدني بيطلع لفوق
   ويتعلق على قضيب الشماعة.
   ============================================================ */
export function Hanger({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 200 74"
      aria-hidden="true"
      className={className}
      fill="none"
      preserveAspectRatio="xMidYMax meet"
    >
      <defs>
        <linearGradient id="vs-wood" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d9a86c" />
          <stop offset="0.55" stopColor="#b9814a" />
          <stop offset="1" stopColor="#8f5f31" />
        </linearGradient>
        <linearGradient id="vs-metal" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#7c828b" />
          <stop offset="0.5" stopColor="#c9cdd2" />
          <stop offset="1" stopColor="#7c828b" />
        </linearGradient>
      </defs>

      {/* الخطاف */}
      <path
        d="M100 40 V22 C100 10 92 3 83 3 C74 3 68 9 68 16"
        stroke="url(#vs-metal)"
        strokeWidth="3.4"
        strokeLinecap="round"
      />

      {/* الخشب: قوس هادي من الكتف للكتف */}
      <path
        d="M8 66 C40 52 72 40 100 38 C128 40 160 52 192 66 C193 70 190 73 186 72 C156 62 128 52 100 51 C72 52 44 62 14 72 C10 73 7 70 8 66 Z"
        fill="url(#vs-wood)"
      />
      <path
        d="M24 61 C52 50 76 43 100 42 C124 43 148 50 176 61"
        stroke="#e6bf8e"
        strokeOpacity="0.55"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}
