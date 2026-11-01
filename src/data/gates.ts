// The five survival tests ("gates" in the blueprint). Test 2 has two parts: 2A (rejection of donor cells)
// and 2B (autoimmune attack), so the scoring model has six factors across five tests.
// Plain-English copy. Gene names appear in the explanation so scientists can see exactly what is meant.

export interface TestPart {
  code: string;
  title: string;
  text: string;
}

export interface Gate {
  /** Test number, 1 to 5. Also the ring on the hero picture. */
  n: number;
  /** The id used in release.json scores and in the blueprint. */
  id: string;
  short: string;
  name: string;
  ask: string;
  /** What the test is, in plain English. */
  explain: string[];
  /** Test 2 only. */
  parts?: TestPart[];
}

export const gates: Gate[] = [
  {
    n: 1,
    id: '1',
    short: 'Insulin response',
    name: 'Insulin that responds to blood sugar',
    ask: 'Do the cells release insulin in the right amount when blood sugar rises, and stop quickly when it falls?',
    explain: [
      'A healthy pancreas gives a quick burst of insulin when sugar rises, then a steady supply, and shuts off fast when sugar drops. The new cells have to do the same, or blood sugar swings too high or too low.',
      'That means growing the right mix of mature cells (about 60% beta, 30% alpha and 10% delta) in small clusters, so every cell gets oxygen and can sense sugar. Insulin should stop within about 3 minutes of sugar falling.',
    ],
  },
  {
    n: 2,
    id: '2',
    short: 'Rejection and autoimmunity',
    name: 'The immune system’s long-term attack',
    ask: 'Can the cells avoid being attacked as foreign by the patient’s T cells and antibodies, and by the same autoimmune attack that caused the diabetes?',
    explain: [
      'There are two separate threats here, and the cells must beat both.',
    ],
    parts: [
      {
        code: '2A',
        title: 'Rejection of donor cells',
        text: 'Cells from a donor carry ID flags (HLA proteins) that T cells and antibodies use to spot “not me”. Switching off the genes that build those flags (B2M and CIITA) is meant to make the cells much harder to recognise.',
      },
      {
        code: '2B',
        title: 'The autoimmune attack',
        text: 'Type 1 diabetes began when the immune system learned to attack beta cells, and it still remembers. Even if the cells hide their flags, the patient’s own immune cells can pick up debris from the graft and restart the attack. Small clusters and a pre-built blood supply are meant to leave less debris behind.',
      },
    ],
  },
  {
    n: 3,
    id: '3',
    short: 'Early immune attack',
    name: 'Early attack by natural killer cells, macrophages and blood reactions',
    ask: 'In the first hours, are the cells protected from natural killer cells, macrophages, and the clotting and inflammation that blood contact can trigger?',
    explain: [
      'Cells that have lost their ID flags can look suspicious. Natural killer cells check for those flags, and macrophages eat cells that don’t carry a “don’t eat me” signal. Blood contact can also set off clotting and inflammation.',
      'So the cells are designed to carry two protective signals from the very first hour: HLA-E, which calms natural killer cells, and CD47, which tells macrophages to leave them alone. Both have to be present in large enough amounts from hour zero.',
    ],
  },
  {
    n: 4,
    id: '4',
    short: 'Cell stress',
    name: 'Survival under stress',
    ask: 'Can the cells survive inflammation, killer-cell toxins, insulin-making stress and low oxygen, without dying or losing their identity?',
    explain: [
      'Even when nothing attacks them directly, an inflamed graft can kill beta cells or make them forget how to make insulin. Killer cells also fire a toxin, granzyme B, into their targets.',
      'An edit at the CXCL10 gene (a gene that switches on during inflammation) is designed to make the cells switch on two protections only when inflammation appears: SERPINB9, which should block granzyme B, and PD-L1, a “back off” signal for T cells.',
    ],
  },
  {
    n: 5,
    id: '5',
    short: 'Oxygen and safety',
    name: 'Oxygen supply and safety switch',
    ask: 'Do the cells get oxygen in the first 3 days, and can they be removed or destroyed on command if needed?',
    explain: [
      'A new graft has no blood vessels at first, so cells can run out of oxygen in the first 3 days. The design uses small clusters, pre-built blood-vessel fragments and a material that releases oxygen. The computer model suggests this is enough, but only just: the margin is thin if our assumptions are pessimistic, and nothing has been measured.',
      'Every cell is designed to carry a safety switch (iCasp9). If anything goes wrong, a drug called AP1903, designed to act only on cells that carry the switch, could be given to remove them. Nothing has shown yet that the switch works in every cell.',
    ],
  },
];

/** Names for the scores in release.json, which are keyed by test id including 2A and 2B. */
export const testLabels: Record<string, string> = {
  '1': 'Test 1 · Insulin response',
  '2A': 'Test 2A · Rejection of donor cells',
  '2B': 'Test 2B · Autoimmune attack',
  '3': 'Test 3 · Early immune attack',
  '4': 'Test 4 · Cell stress',
  '5': 'Test 5 · Oxygen and safety',
};

export const testShort: Record<string, string> = {
  '1': 'Insulin response',
  '2A': 'Rejection of donor cells',
  '2B': 'Autoimmune attack',
  '3': 'Early immune attack',
  '4': 'Cell stress',
  '5': 'Oxygen and safety',
};
