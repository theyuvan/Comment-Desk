"use client";

import { AnimatedWave } from "./animated-wave";
import { SponsorMark } from "@/components/visuals/sponsor-marks";

const footerLinks = {
  Product: [
    { name: "What it does", href: "#features" },
    { name: "How it works", href: "#how-it-works" },
    { name: "Pitch", href: "/pitch" },
  ],
  "Built with": [
    { name: "World ID", href: "https://world.org/world-id", mark: "world" as const },
    { name: "ENS", href: "https://ens.domains", mark: "ens" as const },
    { name: "Arkiv", href: "https://arkiv.network", mark: "arkiv" as const },
    { name: "Swarm", href: "https://www.ethswarm.org" },
  ],
};

export function FooterSection() {
  return (
    <footer className="relative border-t border-foreground/10">
      {/* Animated wave background */}
      <div className="absolute inset-0 h-64 opacity-20 pointer-events-none overflow-hidden">
        <AnimatedWave />
      </div>
      
      <div className="relative z-10 max-w-[1400px] mx-auto px-6 lg:px-12">
        {/* Main Footer */}
        <div className="py-16 lg:py-24">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-12 lg:gap-8">
            {/* Brand Column */}
            <div className="col-span-2">
              <a href="#" className="inline-flex items-center gap-2 mb-6">
                <span className="text-2xl font-display">Comment Desk</span>
              </a>

              <p className="text-muted-foreground leading-relaxed mb-8 max-w-xs">
                A platform for verifiable public input. One real human per voice, and a record anyone can recount.
              </p>
            </div>

            {/* Link Columns */}
            {Object.entries(footerLinks).map(([title, links]) => (
              <div key={title}>
                <h3 className="text-sm font-medium mb-6">{title}</h3>
                <ul className="space-y-4">
                  {links.map((link) => (
                    <li key={link.name}>
                      <a
                        href={link.href}
                        className="text-sm text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-2"
                      >
                        {"mark" in link && link.mark && <SponsorMark id={link.mark} className="h-4 w-4 shrink-0" />}
                        {link.name}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="py-8 border-t border-foreground/10 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            Built at ETHGlobal Mumbai, November 2026.
          </p>
        </div>
      </div>
    </footer>
  );
}
