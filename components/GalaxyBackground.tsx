"use client";

import React from "react";

export default function GalaxyBackground() {
  return (
    <div className="galaxy-bg-container" aria-hidden="true">
      <div className="galaxy-bg-image" />
      <div className="galaxy-stars-twinkle" />
      <div className="galaxy-bg-overlay" />
    </div>
  );
}
