import React from 'react';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';
import { useTheme } from '../theme/ThemeContext';

const VIEWBOX_WIDTH = 200;
const VIEWBOX_HEIGHT = 150;

interface EmptyStateIllustrationProps {
  /** Rendered width in dp; height follows the illustration aspect ratio. */
  size?: number;
}

export function EmptyStateIllustration({ size = 160 }: EmptyStateIllustrationProps) {
  const { colors } = useTheme();

  const cardFill = colors.bg.soft;
  const bubbleFill = colors.bg.card;
  const outline = colors.border.default;
  const detail = colors.text.soft;
  const accent = colors.primary;

  return (
    <Svg
      width={size}
      height={size * (VIEWBOX_HEIGHT / VIEWBOX_WIDTH)}
      viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
      accessible={false}
    >
      <G>
        <Path d="M36 38 L44 45 L37 54 L29 47 Z" fill={cardFill} opacity={0.85} />
        <Path d="M172 58 L181 66 L173 77 L164 69 Z" fill={cardFill} opacity={0.85} />
      </G>

      <G>
        <Path
          d="M44 104 L44 62"
          stroke={outline}
          strokeWidth={2}
          strokeLinecap="round"
        />
        <Path
          d="M44 96 C33 94 27 85 29 76 C38 77 44 86 44 96 Z"
          fill={bubbleFill}
          stroke={outline}
          strokeWidth={1.6}
          strokeLinejoin="round"
        />
        <Path
          d="M44 86 C55 84 61 75 59 66 C50 67 44 76 44 86 Z"
          fill={bubbleFill}
          stroke={outline}
          strokeWidth={1.6}
          strokeLinejoin="round"
        />
        <Path
          d="M44 74 C35 72 30 64 32 56 C40 57 44 65 44 74 Z"
          fill={bubbleFill}
          stroke={outline}
          strokeWidth={1.6}
          strokeLinejoin="round"
        />
        <Path
          d="M44 66 C45 56 49 48 55 44 C58 52 53 62 44 66 Z"
          fill={bubbleFill}
          stroke={outline}
          strokeWidth={1.6}
          strokeLinejoin="round"
        />
        <Path
          d="M30 105 L58 105 L54.5 131 C54.3 132.7 52.9 134 51.2 134 L36.8 134 C35.1 134 33.7 132.7 33.5 131 Z"
          fill={cardFill}
        />
        <Path
          d="M28 101 L60 101 L59 109 L29 109 Z"
          fill={cardFill}
          opacity={0.7}
        />
      </G>

      <G>
        <Rect x={72} y={28} width={72} height={68} rx={19} fill={cardFill} />
        <Rect x={96} y={54} width={7} height={16} rx={3.5} fill={detail} />
        <Rect x={113} y={54} width={7} height={16} rx={3.5} fill={detail} />
      </G>

      <G>
        <Path
          d="M124 127 L115 141 L137 130 Z"
          fill={bubbleFill}
          stroke={outline}
          strokeWidth={1.6}
          strokeLinejoin="round"
        />
        <Rect
          x={112}
          y={87}
          width={68}
          height={44}
          rx={17}
          fill={bubbleFill}
          stroke={outline}
          strokeWidth={1.6}
        />
        <Circle cx={130} cy={109} r={4} fill={detail} opacity={0.55} />
        <Circle cx={146} cy={109} r={4} fill={detail} opacity={0.55} />
        <Circle cx={162} cy={109} r={4} fill={detail} opacity={0.55} />
      </G>

      <Path
        d="M166 12 C167.6 19.4 171.1 22.9 178.5 24.5 C171.1 26.1 167.6 29.6 166 37 C164.4 29.6 160.9 26.1 153.5 24.5 C160.9 22.9 164.4 19.4 166 12 Z"
        fill={accent}
      />
    </Svg>
  );
}
