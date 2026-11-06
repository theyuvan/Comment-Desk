"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { Globe } from "@/components/visuals/globe";

const words = ["verify", "recount", "trust"];

export function HeroSection() {
  const [isVisible, setIsVisible] = useState(false);
  const [wordIndex, setWordIndex] = useState(0);

  useEffect(() => {
    setIsVisible(true);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setWordIndex((prev) => (prev + 1) % words.length);
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  return (
    <section className="relative min-h-screen flex flex-col overflow-hidden">
      {/* Subtle grid lines */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-30">
        {[...Array(8)].map((_, i) => (
          <div
            key={`h-${i}`}
            className="absolute h-px bg-foreground/10"
            style={{
              top: `${12.5 * (i + 1)}%`,
              left: 0,
              right: 0,
            }}
          />
        ))}
        {[...Array(12)].map((_, i) => (
          <div
            key={`v-${i}`}
            className="absolute w-px bg-foreground/10"
            style={{
              left: `${8.33 * (i + 1)}%`,
              top: 0,
              bottom: 0,
            }}
          />
        ))}
      </div>
      
      <div className="relative z-10 w-full max-w-[1400px] mx-auto my-auto px-6 lg:px-12 pt-32 pb-12 lg:pt-36 lg:pb-16">
        {/* The globe, pinned to this 1400px column (not the raw viewport), so it never
            fights the text for space on a wide window. */}
        <div className="pointer-events-none absolute right-6 top-1/2 hidden h-[320px] w-[320px] -translate-y-1/2 opacity-90 md:block lg:right-12 lg:h-[460px] lg:w-[460px]">
          <Globe />
        </div>

        <div className="relative max-w-[560px] md:max-w-[640px] lg:max-w-[720px]">
          {/* Eyebrow */}
          <div
            className={`mb-8 transition-all duration-700 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
            }`}
          >
            <span className="inline-flex items-center gap-3 text-sm font-mono text-muted-foreground">
              <span className="w-8 h-px bg-foreground/30" />
              Verifiable public input
            </span>
          </div>

          {/* Main headline */}
          <div className="mb-12">
            <h1
              className={`text-[clamp(2.75rem,8vw,6rem)] font-display leading-[0.95] tracking-tight transition-all duration-1000 ${
                isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
              }`}
            >
              <span className="block">Public input</span>
              <span className="block">
                you can{" "}
                <span className="relative inline-block">
                  <span
                    key={wordIndex}
                    className="inline-flex"
                  >
                    {words[wordIndex].split("").map((char, i) => (
                      <span
                        key={`${wordIndex}-${i}`}
                        className="inline-block animate-char-in"
                        style={{
                          animationDelay: `${i * 50}ms`,
                        }}
                      >
                        {char}
                      </span>
                    ))}
                  </span>
                  <span className="absolute -bottom-2 left-0 right-0 h-3 bg-foreground/10" />
                </span>
              </span>
            </h1>
          </div>

          {/* Description */}
          <p
            className={`text-xl text-muted-foreground leading-relaxed transition-all duration-700 delay-200 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
            }`}
          >
            It feels like Reddit, but every post is tied to one real human, every thread
            concludes with a ruling, and anyone can recount the record themselves.
          </p>

          {/* CTAs */}
          <div
            className={`mt-10 flex flex-col sm:flex-row items-start gap-4 transition-all duration-700 delay-300 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
            }`}
          >
            <Button asChild size="lg" className="group h-14 rounded-md bg-foreground px-8 text-base text-background transition-colors hover:bg-[#5170ad]">
              <Link href="/pitch">
                See the pitch
                <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-1" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-14 rounded-md border-foreground/20 px-8 text-base hover:border-[#5170ad] hover:text-[#5170ad]">
              <Link href="/dockets">Browse dockets</Link>
            </Button>
          </div>
        </div>
      </div>
      
      {/* Stats marquee: its own band, so it never crowds the content above */}
      <div
        className={`relative z-10 border-y border-foreground/10 bg-background/85 backdrop-blur-sm py-6 lg:py-7 overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_6%,black_94%,transparent)] transition-opacity duration-700 delay-500 ${
          isVisible ? "opacity-100" : "opacity-0"
        }`}
      >
        {/* Two identical copies, each with trailing space, so -50% loops without a jump */}
        <div className="flex w-max marquee hover:[animation-play-state:paused] motion-reduce:animate-none whitespace-nowrap">
          {[...Array(2)].map((_, i) => (
            <div key={i} aria-hidden={i > 0} className="flex shrink-0 items-center gap-16 lg:gap-24 pr-16 lg:pr-24">
              {[
                { value: "20,000", label: "AI comments, real identities", company: "CIVICLICK" },
                { value: "37,000", label: "fake AI comments", company: "WASHINGTON STATE" },
                { value: "18M", label: "fake, of 22M comments", company: "FCC, 2017" },
                { value: "0", label: "of those portals checked for a human", company: "THE GAP" },
              ].map((stat) => (
                <div key={`${stat.company}-${i}`} className="flex items-center gap-4">
                  <span className="text-4xl lg:text-5xl font-display leading-none">{stat.value}</span>
                  <span className="text-sm leading-tight text-muted-foreground">
                    {stat.label}
                    <span className="block font-mono text-xs mt-1">{stat.company}</span>
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      
      {/* Scroll indicator */}
      
    </section>
  );
}
