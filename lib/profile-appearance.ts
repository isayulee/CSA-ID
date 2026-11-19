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

export function profileAppearanceStyle(appearance?: ProfileAppearance | null): CSSProperties {
  if (!appearance) return {};

  const { cardColor, cardOpacity, iconColor, frosted } = appearance;
  const channels = [1, 3, 5].map((start) => parseInt(cardColor.slice(start, start + 2), 16));
  const opacity = cardOpacity / 100;
  const luminance = channels.reduce((total, channel, index) => {
    const blended = (channel * opacity + 128 * (1 - opacity)) / 255;
    const linear = blended <= 0.04045 ? blended / 12.92 : ((blended + 0.055) / 1.055) ** 2.4;
    return total + linear * [0.2126, 0.7152, 0.0722][index];
  }, 0);

  return {
    "--profile-card-fill": `rgb(${channels.join(" ")} / ${opacity})`,
    "--profile-card-ink": luminance > 0.179 ? "#000000" : "#FFFFFF",
    "--profile-card-blur": frosted ? "blur(18px)" : "none",
    "--profile-icon-color": iconColor,
  } as CSSProperties;
}
