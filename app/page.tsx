import { AccountLink } from '@/components/account-link';
import type { Metadata } from 'next';
import Link from 'next/link';
import { SiTypescript, SiNextdotjs, SiSupabase, SiVercel, SiRaspberrypi } from 'react-icons/si';
import { FaGithub } from 'react-icons/fa';
import {
  LuArrowUpRight,
  LuActivity,
  LuMessageCircle,
  LuWind,
  LuCode,
  LuBookOpen,
  LuArrowRight,
  LuCpu,
} from 'react-icons/lu';
import { BrandMark } from '@/components/brand-mark';
import styles from './page.module.css';

export const metadata: Metadata = {
  alternates: { canonical: 'https://digitalnose.ai' },
  title: 'Digital Nose · Make sense of the air around you',
  description:
    'An open-source air sensing project that brings sensor readings, smell observations and weather together. Explore the demo or build your own setup.',
};
const repo = 'https://github.com/pvolansky/digitalnose';
const points = Array.from({ length: 121 }, (_, i) => {
  const peak = 104 * Math.exp(-Math.pow((i - 78) / 9, 2));
  return `${i * 7},${166 - peak - 10 * Math.sin(i / 5) - 5 * Math.sin(i * 1.7)}`;
}).join(' ');

export default function Home() {
  return (
    <div className={styles.page}>
      <a className={styles.skip} href="#main">
        Skip to content
      </a>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link className="brand" href="/" aria-label="Digital Nose home">
            <BrandMark />
            Digital Nose
          </Link>
          <nav aria-label="Public navigation" className={styles.nav}>
            <a href="#how-it-works">How it works</a>
            <a href="#open-source">Open source</a>
            <AccountLink className={styles.signIn}>
              <LuArrowUpRight aria-hidden="true" />
            </AccountLink>
          </nav>
        </div>
      </header>
      <main id="main" className={styles.main}>
        <section className={styles.hero} aria-labelledby="intro-title">
          <p className={styles.kicker}>
            <span /> Open-source air sensing
          </p>
          <h1 id="intro-title">
            There’s more to <span className={styles.airGradient}>air</span>
            <br />
            than a number.
          </h1>
          <p className={styles.lead}>
            Keep a record of air readings, smell reports and local conditions, ready to revisit when
            you need to understand what happened.
          </p>
          <div className={styles.actions}>
            <Link href="/demo" className={styles.primary}>
              <BrandMark />
              Explore the demo <LuArrowRight aria-hidden="true" />
            </Link>
            <a href={repo} target="_blank" rel="noopener noreferrer" className={styles.secondary}>
              <FaGithub aria-hidden="true" />
              View on GitHub
            </a>
          </div>
          <p className={styles.micro}>No account needed for the demo. Apache 2.0 licensed.</p>
        </section>

        <section className={styles.showcase} aria-label="Illustrative product preview">
          <div className={styles.previewTop}>
            <span>
              <LuActivity aria-hidden="true" />
              Readings & surroundings
            </span>
            <span className={styles.sample}>Illustrative preview</span>
          </div>
          <div className={styles.previewBody}>
            <div className={styles.previewHeading}>
              <div>
                <p className={styles.kicker}>The full picture</p>
                <h2>A moment, with context.</h2>
              </div>
              <span className={styles.metric}>
                TVOC <small>ppb</small>
              </span>
            </div>
            <div className={styles.chart}>
              <svg viewBox="0 0 900 245" role="img" aria-labelledby="preview-title preview-desc">
                <title id="preview-title">Example air readings alongside a window-open event</title>
                <desc id="preview-desc">
                  An illustrative TVOC peak overlaps a recorded open window. A smell report and wind
                  direction add context, without establishing a cause.
                </desc>
                {[60, 110, 160, 210].map((y, i) => (
                  <g key={y}>
                    <text x="0" y={y + 4} fill="#6b7890" fontSize="11">
                      {[300, 200, 100, 0][i]}
                    </text>
                    <line x1="40" x2="880" y1={y} y2={y} stroke="#e5e9f1" strokeDasharray="3 5" />
                  </g>
                ))}
                <rect x="517" y="40" width="146" height="170" fill="#f8edce" opacity=".8" />
                <polyline
                  points={points}
                  transform="translate(40 0)"
                  fill="none"
                  stroke="#4265d6"
                  strokeWidth="2.8"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                <line x1="586" x2="586" y1="34" y2="210" stroke="#cf6a4b" strokeDasharray="3 5" />
                <circle cx="586" cy="32" r="5" fill="#cf6a4b" />
                <text x="40" y="238" fontSize="11" fill="#6b7890">
                  12:00
                </text>
                <text x="880" y="238" textAnchor="end" fontSize="11" fill="#6b7890">
                  18:00
                </text>
              </svg>
            </div>
            <div className={styles.contextStrip}>
              <span>
                <i className={styles.windowDot} />
                Window open <small>15:25–16:30</small>
              </span>
              <span>
                <LuMessageCircle aria-hidden="true" />
                Smell reported <small>4 / 5</small>
              </span>
              <span>
                <LuWind aria-hidden="true" />
                SW <small>14 km/h</small>
              </span>
            </div>
          </div>
          <div className={styles.previewBottom}>
            <span>Look for patterns. Add the context that numbers miss.</span>
            <Link href="/demo">
              Try the interactive version <LuArrowUpRight aria-hidden="true" />
            </Link>
          </div>
        </section>

        <section className={styles.technology} aria-label="Technology and hardware">
          <p>Built with familiar tools. Connected to real-world sensing.</p>
          <ul>
            {[
              { Icon: SiTypescript, name: 'TypeScript' },
              { Icon: SiNextdotjs, name: 'Next.js' },
              { Icon: SiSupabase, name: 'Supabase' },
              { Icon: SiVercel, name: 'Vercel' },
              { Icon: SiRaspberrypi, name: 'Raspberry Pi' },
            ].map(({ Icon, name }) => (
              <li key={name}>
                <Icon aria-hidden="true" />
                <span>{name}</span>
              </li>
            ))}
            <li>
              <LuCpu aria-hidden="true" />
              <span>
                DFRobot<small>Gravity · ENS160</small>
              </span>
            </li>
          </ul>
          <small>
            Reference hardware: Raspberry Pi 5, Gravity IO Expansion HAT and Gravity ENS160 sensor.
          </small>
        </section>

        <section className={styles.motivation} aria-labelledby="why-title">
          <div>
            <p className={styles.kicker}>Why Digital Nose exists</p>
            <h2 id="why-title">
              A smell passes.
              <br />
              The record stays.
            </h2>
          </div>
          <div>
            <p>
              A takeaway opens nearby and cooking smells start drifting in. Paint fumes linger after
              work next door, or a strong cleaning smell keeps returning. By the time you speak to
              Environmental Health, the smell may have gone.
            </p>
            <p>
              Digital Nose helps you keep a record while it happens. Log what you notice alongside
              air readings, window activity and weather, so you can show when smells occurred and
              how often they returned. If you later contact your council’s Environmental Health
              team, you have a history to discuss rather than relying on memory.
            </p>
            <details>
              <summary>Where does Environmental Health fit in?</summary>
              <p>
                In England, councils commonly use human smell assessments and may ask people to keep
                odour diaries. Weather and wind also matter. Digital Nose adds a record over time to
                support those conversations; it does not replace professional assessment or
                determine whether a statutory nuisance exists.
              </p>
              <a
                href="https://www.gov.uk/guidance/nuisance-smells-how-councils-deal-with-complaints"
                target="_blank"
                rel="noopener noreferrer"
              >
                How councils assess nuisance smells <LuArrowUpRight aria-hidden="true" />
              </a>
            </details>
          </div>
        </section>

        <section id="how-it-works" className={styles.section}>
          <p className={styles.kicker}>From sensing to understanding</p>
          <h2>
            Connect the reading
            <br />
            with the real world.
          </h2>
          <div className={styles.features}>
            {[
              {
                Icon: LuActivity,
                title: 'Measure over time',
                text: 'Follow TVOC, estimated CO₂ and the sensor’s air-quality index. See changes over time, with clear device health and data freshness.',
              },
              {
                Icon: LuMessageCircle,
                title: 'Record what you notice',
                text: 'Add a smell, its intensity and a note. Residents contribute observations; the owner records window and room occupancy changes.',
              },
              {
                Icon: LuWind,
                title: 'Put it in context',
                text: 'Compare readings with wind, weather and room activity on the same timeline. Explore what happened around a peak.',
              },
            ].map(({ Icon, title, text }) => (
              <article key={title}>
                <Icon aria-hidden="true" />
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
          <p className={styles.caption}>
            Sensor estimates help reveal patterns. They do not identify individual chemicals, prove
            a source, or certify that air is safe.
          </p>
        </section>

        <section id="open-source" className={styles.openSource}>
          <div>
            <p className={styles.kicker}>Open by design</p>
            <h2>
              Better questions.
              <br />
              Shared understanding.
            </h2>
            <p>
              Understanding recurring smells should not depend on memory alone. Digital Nose makes
              the method visible: how readings are collected, how observations are recorded, and how
              they appear together.
            </p>
            <p>
              Keeping the project open source means you can inspect how it works, run your own
              setup, adapt it to your needs, and contribute improvements. The code is shared so the
              tools for understanding air can be improved together.
            </p>
            <a className={styles.lightButton} href={repo} target="_blank" rel="noopener noreferrer">
              <FaGithub aria-hidden="true" />
              Explore the repository <LuArrowUpRight aria-hidden="true" />
            </a>
          </div>
          <div className={styles.openNotes}>
            <div>
              <LuCode aria-hidden="true" />
              <h3>Read it. Run it. Adapt it.</h3>
              <p>Application code, sensor integration and setup instructions in one repository.</p>
            </div>
            <div>
              <LuBookOpen aria-hidden="true" />
              <h3>Apache License 2.0</h3>
              <p>Use and modify the project under a permissive open-source license.</p>
              <a href={`${repo}/blob/main/LICENSE`} target="_blank" rel="noopener noreferrer">
                Read the license <LuArrowUpRight aria-hidden="true" />
              </a>
            </div>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="start-title">
          <p className={styles.kicker}>Start with curiosity</p>
          <h2 id="start-title">Explore first. Build when you’re ready.</h2>
          <div className={styles.startGrid}>
            <Link href="/demo">
              <BrandMark />
              <h3>Take a look around</h3>
              <p>
                Explore a complete example with sensor readings, smell reports and weather. No
                hardware or account needed.
              </p>
              <span>
                Open demo <LuArrowRight aria-hidden="true" />
              </span>
            </Link>
            <a href={`${repo}#raspberry-pi-setup`} target="_blank" rel="noopener noreferrer">
              <LuBookOpen aria-hidden="true" />
              <h3>Build your own setup</h3>
              <p>
                Start with the Raspberry Pi and ENS160 guide, then connect your sensor to your own
                deployment.
              </p>
              <span>
                Read the setup guide <LuArrowUpRight aria-hidden="true" />
              </span>
            </a>
          </div>
          <p className={styles.existing}>
            Already have access to a site?{' '}
            <AccountLink signedOutLabel="Sign in to your dashboard">
              <LuArrowRight aria-hidden="true" />
            </AccountLink>
          </p>
        </section>
      </main>
      <footer className={styles.footer}>
        <span>Digital Nose · Open-source air sensing</span>
        <a href="https://piotrwolanski.com/" target="_blank" rel="noopener noreferrer">
          Created by Piotr Wolanski
        </a>
      </footer>
    </div>
  );
}
