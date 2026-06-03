import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { MoveRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

function GithubIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M12 .5a12 12 0 0 0-3.79 23.39c.6.11.82-.26.82-.58v-2.03c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.21.09 1.84 1.24 1.84 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.34-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.12-3.17 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.65.25 2.87.12 3.17.77.84 1.24 1.91 1.24 3.22 0 4.6-2.81 5.62-5.49 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.83.58A12 12 0 0 0 12 .5Z" />
    </svg>
  );
}

function Hero() {
  const [titleNumber, setTitleNumber] = useState(0);
  const titles = useMemo(
    () => ["viral", "on-brand", "automatic", "effortless", "24/7"],
    []
  );

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setTitleNumber((n) => (n === titles.length - 1 ? 0 : n + 1));
    }, 2000);
    return () => clearTimeout(timeoutId);
  }, [titleNumber, titles]);

  return (
    <div className="relative w-full overflow-hidden bg-background text-foreground">
      {/* subtle grid */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.18]"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.08) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
          maskImage:
            "radial-gradient(ellipse 70% 60% at 50% 40%, black 30%, transparent 75%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 70% 60% at 50% 40%, black 30%, transparent 75%)",
        }}
      />
      {/* soft top glow */}
      <div className="pointer-events-none absolute left-1/2 top-0 h-[420px] w-[820px] -translate-x-1/2 rounded-full bg-white/10 blur-[140px]" />

      <div className="container relative mx-auto px-6">
        <div className="flex min-h-screen flex-col items-center justify-center gap-8 py-20">
          <div>
            <Button
              variant="secondary"
              size="sm"
              className="gap-2 rounded-full border border-white/10 bg-white/5 backdrop-blur"
            >
              <Sparkles className="h-4 w-4" /> Synthetic Minds · Carousel Bot
            </Button>
          </div>

          <div className="flex flex-col gap-5">
            <h1 className="max-w-3xl text-center text-5xl font-semibold tracking-tighter md:text-7xl">
              <span className="text-white/70">Turn trending news into</span>
              <span className="relative flex w-full justify-center overflow-hidden pt-1 text-center md:pb-3 md:pt-2">
                &nbsp;
                {titles.map((title, index) => (
                  <motion.span
                    key={index}
                    className="absolute font-semibold text-white"
                    initial={{ opacity: 0, y: -100 }}
                    transition={{ type: "spring", stiffness: 50 }}
                    animate={
                      titleNumber === index
                        ? { y: 0, opacity: 1 }
                        : { y: titleNumber > index ? -150 : 150, opacity: 0 }
                    }
                  >
                    {title}
                  </motion.span>
                ))}
              </span>
              <span className="text-white">Instagram carousels.</span>
            </h1>

            <p className="mx-auto max-w-2xl text-center text-lg leading-relaxed tracking-tight text-muted-foreground md:text-xl">
              An AI that scans tech headlines, writes the copy, designs both
              slides, and posts to Instagram on a schedule — completely on its
              own.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg" className="gap-3">
              <a href="/">
                Open dashboard <MoveRight className="h-4 w-4" />
              </a>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="gap-3 border-white/15 bg-transparent text-white hover:bg-white/10 hover:text-white"
            >
              <a
                href="https://github.com/Deepakvutla9/Twitter_Viral_post"
                target="_blank"
                rel="noreferrer"
              >
                <GithubIcon className="h-4 w-4" /> View on GitHub
              </a>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export { Hero };
