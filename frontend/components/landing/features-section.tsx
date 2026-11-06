"use client";

import { useEffect, useRef, useState } from "react";
import { Globe } from "@/components/visuals/globe";

const features = [
  {
    number: "01",
    title: "One human, one voice",
    description: "Every member verifies once with World ID. One person gets one identity and one counted comment per topic.",
    visual: "globe",
  },
  {
    number: "02",
    title: "Every name is real",
    description: "ENSv2 decides who can comment, not just our server. A moderator's write to one ENS record can close a docket even if our own database still says open.",
    visual: "ens",
  },
  {
    number: "03",
    title: "Agents draft, humans approve",
    description: "Your agent can write a comment, but it never posts alone. A fresh confirm is bound to the exact text, so changed words need a new approval.",
    visual: "ai",
  },
  {
    number: "04",
    title: "Recount it yourself",
    description: "The record lives on Arkiv, not in our database. Anyone can re-derive the tally with no account and no trust in our server.",
    visual: "arkiv",
  },
  {
    number: "05",
    title: "A case, not a feed",
    description: "A docket has a deadline and a published ruling. When it closes, the full record moves to Swarm as the permanent case file.",
    visual: "security",
  },
];

function GlobeVisual() {
  return (
    <div className="w-32 h-32 lg:w-40 lg:h-40">
      <Globe seats={14} />
    </div>
  );
}

/** A name resolving down a small ENS tree: root to member to docket. */
function EnsVisual() {
  const nodes = [
    { x: 100, y: 20 },
    { x: 100, y: 78 },
    { x: 45, y: 136 },
    { x: 155, y: 136 },
  ];
  return (
    <svg viewBox="0 0 200 160" className="w-full h-full">
      <path d="M100 20 L100 78" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.3" />
      <path d="M100 78 L45 136 M100 78 L155 136" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.3" />

      {/* A resolution pulse travelling from the root down to a leaf name */}
      <circle r="4" fill="currentColor">
        <animateMotion dur="2.2s" repeatCount="indefinite" path="M100,20 L100,78 L45,136" />
      </circle>

      {nodes.map(({ x, y }, i) => (
        <g key={i}>
          <circle cx={x} cy={y} r={i === 0 ? 10 : 8} fill={i === 0 ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" />
          {i === 0 && <circle cx={x} cy={y} r="18" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.25" />}
        </g>
      ))}
    </svg>
  );
}

/** Three linked entities, one query away from anyone's browser. */
function ArkivVisual() {
  const rows = [
    { x: 55, y: 45 },
    { x: 145, y: 45 },
    { x: 100, y: 120 },
  ];
  const cylinder = (x: number, y: number, filled: boolean) => (
    <g key={`${x}-${y}`}>
      {[10, 0, -10].map((dy) => (
        <ellipse key={dy} cx={x} cy={y + dy} rx="26" ry="8" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5" opacity={filled ? 0.9 : 1} />
      ))}
    </g>
  );
  return (
    <svg viewBox="0 0 200 160" className="w-full h-full">
      <path d="M55 45 L100 120 L145 45" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.3" />
      <circle r="3.5" fill="currentColor">
        <animateMotion dur="1.8s" repeatCount="indefinite" path="M55,45 L100,120 L145,45 L55,45" />
      </circle>
      {cylinder(rows[0]!.x, rows[0]!.y, false)}
      {cylinder(rows[1]!.x, rows[1]!.y, false)}
      {cylinder(rows[2]!.x, rows[2]!.y, true)}
    </svg>
  );
}

function AIVisual() {
  return (
    <svg viewBox="0 0 200 160" className="w-full h-full">
      {/* Central node */}
      <circle cx="100" cy="80" r="12" fill="currentColor">
        <animate attributeName="r" values="12;14;12" dur="2s" repeatCount="indefinite" />
      </circle>
      
      {/* Orbiting nodes */}
      {[0, 1, 2, 3, 4, 5].map((i) => {
        const angle = (i * 60) * (Math.PI / 180);
        const radius = 50;
        // Rounded so the server and the browser print the same number.
        const x = (100 + Math.cos(angle) * radius).toFixed(3);
        const y = (80 + Math.sin(angle) * radius).toFixed(3);
        return (
          <g key={i}>
            {/* Connection line */}
            <line
              x1="100"
              y1="80"
              x2={x}
              y2={y}
              stroke="currentColor"
              strokeWidth="1"
              opacity="0.3"
            >
              <animate
                attributeName="opacity"
                values="0.3;0.8;0.3"
                dur="2s"
                begin={`${i * 0.3}s`}
                repeatCount="indefinite"
              />
            </line>
            
            {/* Outer node */}
            <circle
              cx={x}
              cy={y}
              r="6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <animate
                attributeName="r"
                values="6;8;6"
                dur="2s"
                begin={`${i * 0.3}s`}
                repeatCount="indefinite"
              />
            </circle>
          </g>
        );
      })}
      
      {/* Pulse rings */}
      <circle cx="100" cy="80" r="30" fill="none" stroke="currentColor" strokeWidth="1" opacity="0">
        <animate attributeName="r" values="20;60" dur="2s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.5;0" dur="2s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}

function SecurityVisual() {
  return (
    <svg viewBox="0 0 200 160" className="w-full h-full">
      {/* Shield */}
      <path
        d="M 100 20 L 150 40 L 150 90 Q 150 130 100 145 Q 50 130 50 90 L 50 40 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      
      {/* Inner shield */}
      <path
        d="M 100 35 L 135 50 L 135 85 Q 135 115 100 128 Q 65 115 65 85 L 65 50 Z"
        fill="currentColor"
        opacity="0.1"
      >
        <animate attributeName="opacity" values="0.1;0.2;0.1" dur="2s" repeatCount="indefinite" />
      </path>
      
      {/* Lock icon */}
      <rect x="85" y="70" width="30" height="25" rx="3" fill="currentColor" />
      <path
        d="M 90 70 L 90 60 Q 90 50 100 50 Q 110 50 110 60 L 110 70"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
      
      {/* Keyhole */}
      <circle cx="100" cy="80" r="4" fill="white" />
      <rect x="98" y="82" width="4" height="8" fill="white" />
      
      {/* Scan lines */}
      <line x1="60" y1="60" x2="140" y2="60" stroke="currentColor" strokeWidth="1" opacity="0">
        <animate attributeName="y1" values="40;120;40" dur="3s" repeatCount="indefinite" />
        <animate attributeName="y2" values="40;120;40" dur="3s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0;0.5;0" dur="3s" repeatCount="indefinite" />
      </line>
    </svg>
  );
}

function AnimatedVisual({ type }: { type: string }) {
  switch (type) {
    case "globe":
      return <GlobeVisual />;
    case "ens":
      return <EnsVisual />;
    case "ai":
      return <AIVisual />;
    case "arkiv":
      return <ArkivVisual />;
    case "security":
      return <SecurityVisual />;
    default:
      return <GlobeVisual />;
  }
}

function FeatureCard({ feature, index }: { feature: typeof features[0]; index: number }) {
  const [isVisible, setIsVisible] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setIsVisible(true);
      },
      { threshold: 0.2 }
    );

    if (cardRef.current) observer.observe(cardRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={cardRef}
      className={`group relative transition-all duration-700 ${
        isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-12"
      }`}
      style={{ transitionDelay: `${index * 100}ms` }}
    >
      <div className="flex flex-col lg:flex-row gap-8 lg:gap-16 py-12 lg:py-20 border-b border-foreground/10">
        {/* Number */}
        <div className="shrink-0">
          <span className="font-mono text-sm text-muted-foreground">{feature.number}</span>
        </div>
        
        {/* Content */}
        <div className="flex-1 grid lg:grid-cols-2 gap-8 items-center">
          <div>
            <h3 className="text-3xl lg:text-4xl font-display mb-4 group-hover:translate-x-2 transition-transform duration-500">
              {feature.title}
            </h3>
            <p className="text-lg text-muted-foreground leading-relaxed">
              {feature.description}
            </p>
          </div>
          
          {/* Visual */}
          <div className="flex justify-center lg:justify-end">
            <div className="w-48 h-40 text-foreground">
              <AnimatedVisual type={feature.visual} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function FeaturesSection() {
  const [isVisible, setIsVisible] = useState(false);
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setIsVisible(true);
      },
      { threshold: 0.1 }
    );

    if (sectionRef.current) observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      id="features"
      ref={sectionRef}
      className="relative py-24 lg:py-32"
    >
      <div className="max-w-[1400px] mx-auto px-6 lg:px-12">
        {/* Header */}
        <div className="mb-16 lg:mb-24">
          <span className="inline-flex items-center gap-3 text-sm font-mono text-muted-foreground mb-6">
            <span className="w-8 h-px bg-foreground/30" />
            What it does
          </span>
          <h2
            className={`text-4xl lg:text-6xl font-display tracking-tight transition-all duration-700 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
            }`}
          >
            Input you can defend.
            <br />
            <span className="text-muted-foreground">Not just input you received.</span>
          </h2>
        </div>

        {/* Features List */}
        <div>
          {features.map((feature, index) => (
            <FeatureCard key={feature.number} feature={feature} index={index} />
          ))}
        </div>
      </div>
    </section>
  );
}
