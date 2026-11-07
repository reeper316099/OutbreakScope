// Illustrative disease presets. Every number has a citation; derived numbers say how they were derived.
// These are "illustrative values from the literature", NOT predictions about any current outbreak.
// Full provenance (links, licences, caveats) is in DATA-SOURCES.md.
import type { ModelKind } from '../shared/types';

export interface PresetValue {
  value: number;
  /** Plausible range; its meaning is given by `rangeBasis` on the preset. */
  low: number;
  high: number;
  /** "reported": copied from the source. "derived": computed from sourced numbers (formula in `how`). "assumed": hypothetical teaching value. */
  kind: 'reported' | 'derived' | 'assumed';
  how: string;
}

export interface PresetSource {
  label: string;
  url: string;
}

export interface Preset {
  id: string;
  name: string;
  /** Model the preset is meant for (SIR when no incubation period could be sourced). */
  model: ModelKind;
  r0: PresetValue;
  incubationDays: PresetValue | null;
  infectiousDays: PresetValue;
  rangeBasis: string;
  sources: PresetSource[];
  caveat: string;
}

const LI = {
  label: 'Li et al. 2020, NEJM (early Wuhan transmission)',
  url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC7121484/',
};
const BIGGERSTAFF = {
  label: 'Biggerstaff et al. 2014, BMC Infect Dis (influenza reproduction numbers)',
  url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC4169819/',
};
const CARRAT = {
  label: 'Carrat et al. 2008, Am J Epidemiol (influenza time lines)',
  url: 'https://pubmed.ncbi.nlm.nih.gov/18230677/',
};
const GUERRA = {
  label: 'Guerra et al. 2017, Lancet Infect Dis (measles R0 review)',
  url: 'https://pubmed.ncbi.nlm.nih.gov/28757186/',
};
const PINK = {
  label: 'CDC Pink Book, measles chapter',
  url: 'https://www.cdc.gov/pinkbook/hcp/table-of-contents/chapter-13-measles.html',
};
const WHO_EBOLA = {
  label: 'WHO Ebola Response Team 2014, NEJM (first 9 months)',
  url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC4235004/',
};

export const PRESETS: readonly Preset[] = [
  {
    id: 'seasonal-flu',
    name: 'Seasonal influenza-like (SIR)',
    model: 'SIR',
    r0: {
      value: 1.28,
      low: 1.19,
      high: 1.37,
      kind: 'reported',
      how: 'Median community R for seasonal influenza; range is the interquartile range across studies.',
    },
    incubationDays: null,
    infectiousDays: {
      value: 4.8,
      low: 4.31,
      high: 5.29,
      kind: 'reported',
      how: 'Mean duration of viral shedding in volunteer challenge studies (95% CI), used as a stand-in for the infectious period.',
    },
    rangeBasis: 'R0: interquartile range; infectious period: 95% CI of the mean',
    sources: [BIGGERSTAFF, CARRAT],
    caveat:
      'No incubation period could be sourced, so this preset uses SIR. Shedding duration is only a proxy for infectiousness.',
  },
  {
    id: 'pandemic-flu-1918',
    name: '1918-like pandemic influenza (SIR)',
    model: 'SIR',
    r0: {
      value: 1.8,
      low: 1.47,
      high: 2.27,
      kind: 'reported',
      how: 'Median R for the 1918 pandemic; range is the interquartile range across studies.',
    },
    incubationDays: null,
    infectiousDays: {
      value: 4.8,
      low: 4.31,
      high: 5.29,
      kind: 'reported',
      how: 'Same shedding-duration proxy as the seasonal preset (not measured for 1918).',
    },
    rangeBasis: 'R0: interquartile range; infectious period: 95% CI of the mean',
    sources: [BIGGERSTAFF, CARRAT],
    caveat: 'The infectious period comes from modern volunteer studies, not from 1918 data.',
  },
  {
    id: 'covid-early',
    name: 'COVID-19-like, early Wuhan estimates (SEIR)',
    model: 'SEIR',
    r0: {
      value: 2.2,
      low: 1.4,
      high: 3.9,
      kind: 'reported',
      how: 'Early-outbreak estimate (95% CI).',
    },
    incubationDays: {
      value: 5.2,
      low: 4.1,
      high: 7.0,
      kind: 'reported',
      how: 'Mean incubation period (95% CI).',
    },
    infectiousDays: {
      value: 2.3,
      low: 0.1,
      high: 13.8,
      kind: 'derived',
      how: 'In an SEIR model with exponential stages the mean generation interval is incubation + infectious period, so infectious = serial interval (7.5 d) - incubation (5.2 d) = 2.3 d. Assumes serial interval ~ generation interval. Range = serial-interval 95% CI (5.3-19 d) minus the incubation mean (5.2 d); it is very wide.',
    },
    rangeBasis:
      'R0 and incubation: 95% CI; infectious period: derived from the serial-interval CI (very wide)',
    sources: [LI],
    caveat:
      'Early-pandemic estimates from 425 cases. Later variants, immunity and behaviour changed these numbers a lot. The derived infectious period is short because transmission before symptoms is folded into the exposed-to-infectious step.',
  },
  {
    id: 'measles',
    name: 'Measles-like (SEIR)',
    model: 'SEIR',
    r0: {
      value: 15,
      low: 12,
      high: 18,
      kind: 'derived',
      how: 'Midpoint of the commonly cited range 12-18 (the review notes published estimates vary more widely than this range).',
    },
    incubationDays: {
      value: 10,
      low: 3,
      high: 17,
      kind: 'derived',
      how: 'Latent period ~ average exposure-to-rash time (14 d) minus the 4 days before rash during which measles is already transmissible = 10 d. Range = the quoted 7-21 d exposure-to-rash range minus 4 d.',
    },
    infectiousDays: {
      value: 8,
      low: 8,
      high: 8,
      kind: 'derived',
      how: 'Transmissible from 4 days before to 4 days after rash onset = 8 days. The source gives no range.',
    },
    rangeBasis:
      'R0: commonly cited range; incubation: quoted exposure-to-rash range minus 4 d; infectious period: no range given',
    sources: [GUERRA, PINK],
    caveat:
      'Measles transmission depends heavily on population immunity and contact patterns; this fully susceptible setting is a teaching abstraction.',
  },
  {
    id: 'ebola-west-africa',
    name: 'Ebola-like, West Africa 2014 (SEIR)',
    model: 'SEIR',
    r0: {
      value: 1.71,
      low: 1.44,
      high: 2.26,
      kind: 'reported',
      how: 'Guinea estimate. The range spans the 95% CIs for Guinea (1.44-2.01), Liberia (1.72-1.94) and Sierra Leone (1.79-2.26).',
    },
    incubationDays: {
      value: 11.4,
      low: 9.4,
      high: 11.4,
      kind: 'reported',
      how: 'Mean incubation period for multi-day exposures (observed); single-day exposures gave 9.4 d.',
    },
    infectiousDays: {
      value: 3.9,
      low: 3.9,
      high: 7.5,
      kind: 'derived',
      how: 'Serial interval (15.3 d) - incubation (11.4 d) = 3.9 d, same identity as the COVID preset. The upper end is the reported mean onset-to-death time (7.5 d); mean onset-to-hospitalisation was 5.0 d. There is no sourced lower bound.',
    },
    rangeBasis:
      'R0: union of country 95% CIs; incubation: observed single- and multi-day exposure means; infectious period: between the derived value and onset-to-death time',
    sources: [WHO_EBOLA],
    caveat:
      'The 2014 epidemic mixed community, hospital and funeral transmission, which this homogeneous model does not represent.',
  },
  {
    id: 'hypothetical-mild',
    name: 'Hypothetical mild disease (SEIR, teaching example)',
    model: 'SEIR',
    r0: {
      value: 1.3,
      low: 1.3,
      high: 1.3,
      kind: 'assumed',
      how: 'Invented for teaching; no source.',
    },
    incubationDays: {
      value: 3,
      low: 3,
      high: 3,
      kind: 'assumed',
      how: 'Invented for teaching; no source.',
    },
    infectiousDays: {
      value: 5,
      low: 5,
      high: 5,
      kind: 'assumed',
      how: 'Invented for teaching; no source.',
    },
    rangeBasis: 'none (not from a source)',
    sources: [],
    caveat:
      'Hypothetical values chosen only to show a slow outbreak. Not based on any real disease.',
  },
  {
    id: 'hypothetical-severe',
    name: 'Hypothetical fast-spreading disease (SEIR, teaching example)',
    model: 'SEIR',
    r0: { value: 4, low: 4, high: 4, kind: 'assumed', how: 'Invented for teaching; no source.' },
    incubationDays: {
      value: 2,
      low: 2,
      high: 2,
      kind: 'assumed',
      how: 'Invented for teaching; no source.',
    },
    infectiousDays: {
      value: 4,
      low: 4,
      high: 4,
      kind: 'assumed',
      how: 'Invented for teaching; no source.',
    },
    rangeBasis: 'none (not from a source)',
    sources: [],
    caveat:
      'Hypothetical values chosen only to show a fast, large outbreak. Not based on any real disease.',
  },
];
