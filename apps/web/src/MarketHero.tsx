import { ArrowDown, Flower2, Leaf, MapPin, Sprout } from 'lucide-react';
export function MarketHero() {
  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="eyebrow">
            <Leaf size={14} /> YOUR NEIGHBORHOOD, FRESHLY PICKED
          </p>
          <h1 id="hero-title">
            Good food.
            <br />
            Grown <em>close to home.</em>
          </h1>
          <p className="hero-description">
            Discover what’s growing around you. Fresh produce, independent
            farms, and a shorter journey from field to fork.
          </p>
          <a className="market-link" href="#market">
            Explore the market <ArrowDown size={16} />
          </a>
        </div>
        <div className="harvest-art" aria-hidden="true">
          <div className="art-ring ring-one" />
          <div className="art-ring ring-two" />
          <span className="art-label">A GOOD THING, GROWING.</span>
          <svg viewBox="0 0 400 300" className="vegetable-art" fill="none">
            <path
              d="M55 209Q200 170 345 209L319 270Q201 305 81 270Z"
              fill="#ceb38b"
            />
            <path
              d="M65 227Q200 266 335 227M74 247Q200 282 326 247M103 213L118 282M155 206L161 288M208 205L207 291M261 209L250 285M310 216L291 279"
              stroke="#ae8c62"
              strokeWidth="3"
            />
            <path
              d="M115 216Q56 143 113 120Q102 71 142 88Q160 44 183 87Q222 63 218 108Q264 113 224 169L190 227Z"
              fill="#567d48"
            />
            <path
              d="M155 224L166 112M161 169L126 136M164 148L193 123"
              stroke="#b1c58b"
              strokeWidth="4"
              strokeLinecap="round"
            />
            <path
              d="M222 173Q221 105 254 81L265 94Q268 130 243 183"
              fill="#e8a34c"
            />
            <path
              d="M254 85Q245 59 259 40M258 87Q279 62 295 68M257 86L276 43"
              stroke="#42724b"
              strokeWidth="8"
              strokeLinecap="round"
            />
            <circle cx="240" cy="213" r="43" fill="#c75c42" />
            <circle cx="292" cy="191" r="34" fill="#dc7950" />
            <path
              d="M230 174L239 185L250 174L246 188L260 191L245 195L237 204L235 192L222 187L235 185Z"
              fill="#345c3b"
            />
            <path
              d="M281 160L291 169L303 160L298 174L308 179L293 181L283 186L286 175L276 171Z"
              fill="#42643c"
            />
            <ellipse
              cx="133"
              cy="235"
              rx="42"
              ry="28"
              transform="rotate(-18 133 235)"
              fill="#e0bd6b"
            />
            <path
              d="M110 227L129 239M129 217L147 229"
              stroke="#b69248"
              strokeWidth="3"
              strokeLinecap="round"
            />
            <path
              d="M60 208Q200 250 345 208"
              stroke="#e3caa6"
              strokeWidth="13"
              strokeLinecap="round"
            />
          </svg>
          <span className="art-caption">
            <Flower2 size={16} /> ROOTED IN COMMUNITY
          </span>
        </div>
      </section>
      <div className="values-strip">
        <span>
          <Sprout size={17} /> Grown by independent farms
        </span>
        <span>
          <MapPin size={17} /> Local roots, real connections
        </span>
        <span>
          <Leaf size={17} /> Freshness comes naturally
        </span>
      </div>
    </>
  );
}
