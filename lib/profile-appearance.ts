import type { CSSProperties } from "react";

export type ProfileAppearance = {
  iconColor: string;
  cardColor: string;
  cardOpacity: number;
  frosted: boolean;
};

export const defaultAppearance: ProfileAppearance = {
  iconColor: "#78121A",
  cardColor: "#FFFDF8",
  cardOpacity: 100,
  frosted: false,
};

function luminance(channels: number[], opacity = 1, background = 0) {
  return channels.reduce((total, channel, index) => {
    const blended = (channel * opacity + background * (1 - opacity)) / 255;
    const linear = blended <= 0.04045 ? blended / 12.92 : ((blended + 0.055) / 1.055) ** 2.4;
    return total + linear * [0.2126, 0.7152, 0.0722][index];
  }, 0);
}

function colorChannels(color: string) {
  return [1, 3, 5].map((start) => parseInt(color.slice(start, start + 2), 16));
}

export function profileAccentStyle(color: string): CSSProperties {
  return {
    "--profile-accent": color,
    "--profile-accent-ink": luminance(colorChannels(color)) >= 0.175 ? "#000000" : "#FFFFFF",
  } as CSSProperties;
}

export function profileAppearanceStyle(appearance?: ProfileAppearance | null): CSSProperties {
  if (!appearance) return {};

  const { cardColor, cardOpacity, iconColor, frosted } = appearance;
  const channels = colorChannels(cardColor);
  let effectiveOpacity = cardOpacity;
  let ink = "#000000";
  // The image behind a translucent card can be any color. Check the
  // darkest and lightest possible blends before choosing text color.
  while (effectiveOpacity <= 100) {
    const opacity = effectiveOpacity / 100;
    if (luminance(channels, opacity) >= 0.175) break;
    if (luminance(channels, opacity, 255) <= (1.05 / 4.5) - 0.05) {
      ink = "#FFFFFF";
      break;
    }
    effectiveOpacity += 1;
  }

  return {
    "--profile-card-fill": `rgb(${channels.join(" ")} / ${effectiveOpacity / 100})`,
    "--profile-card-ink": ink,
    "--profile-card-blur": frosted ? "blur(18px)" : "none",
    "--profile-icon-color": iconColor,
  } as CSSProperties;
}
