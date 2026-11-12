---
title: 'Islet-1: an open blueprint for a personalised, drug-free islet cell therapy for type 1 diabetes'
# How to update this document
# - Write in plain English first. Put gene names and technical detail after it.
# - Cite a paper by linking its PubMed ID after "#ref-", like this: [Author 2024](#ref-PMID). Run `npm run sync-data` and the full reference appears at the bottom.
# - Numbers in double curly braces, such as the studies count in Section 6, are filled in from the synced data, so they never go out of date.
# - A line holding an HTML comment with the word figure, a colon and a name marks where the page places a figure or table (see Sections 3 and 7).
# - After a change, record it in the changelog with `npm run changelog`.
---

## Summary

Type 1 diabetes destroys the beta cells that make insulin. Lab-grown islet cells can replace them, but the immune system rejects them unless patients take immune-suppressing drugs for life. Islet-1 is an open research design for stem-cell-derived islets, combining proposed immune-protection edits, an oxygen-supporting setting and a safety switch. Whether the combined product can avoid immune attack and function safely remains unmeasured.

The blueprint compares **Design A**, a four-locus reference family with two cassette layouts, and **Design B**, a family of HLA-C-retaining hypotheses. B1 has six disruption/insertion loci plus an INS edit; B2 has five loci with an optional TYK2 prime edit. Their proposed 2A-free donor cassette is not materialized. The current DNA compiler supports the declared A reference variants, not a complete manufactured B product. **Design X** is the challenger: Design A plus one base edit in the insulin gene ({{editsX}} gene edits and {{baseX}} base edit), with further upgrades that are only proposals. Using {{studies}} study records, {{findings}} extracted findings and {{rules}} Idea Graveyard rules, the model scored {{designs}} combinations. {{blocked}} were blocked by those rules and {{feasible}} remained; the A comparator ranks first in that model, and the X grid challenger second, tied with one other design.

The scores are model estimates, not predictions. {{assumptions}}% of the spread in scores comes from the team's starting assumptions and only {{findingsShare}}% from published findings. **Nothing in the blueprint has been tested in the lab yet.**

## 1. Background and aim

In type 1 diabetes the immune system destroys the beta cells in the pancreatic islets that make insulin. Replacing them is now possible: stem cells can be turned into islet cells, and early reports show insulin production restored in people ([Wang 2024](#ref-39326417); [Carlsson 2025](#ref-40757665)). The unsolved problem is rejection. Cells from a donor are attacked as foreign, so most of today's treatments either need lifelong immune-suppressing drugs, or wall the cells off inside a device, where scar tissue grows and the cells run out of oxygen.

Islet-1 aims for a third route: a personalised therapy whose cells are edited intended to reduce immune attack, with proposed inflammation-responsive protection, an oxygen source for the early graft period, and a safety switch that must be qualified across every graft lineage. The furthest human evidence for the idea is one recipient whose gene-edited donor islets (not stem-cell-derived) survived without immunosuppression ([Carlsson 2025](#ref-40757665)). No multi-edit, stem-cell-derived islet has yet completed a multi-patient trial without drugs.

## 2. The five tests

> **In short.** A graft fails if any one of five tests fails, so a design has to pass all of them.

| Test | The question | How the design responds | Main genes |
| :-- | :-- | :-- | :-- |
| **1. Insulin response** | Do the cells release the right amount of insulin when sugar rises, and stop within about 3 minutes when it falls? | A mature mix of 60% beta, 30% alpha and 10% delta cells, grown in clusters of 120 µm or less | |
| **2A. Rejection of donor cells** | Can the cells avoid being recognised as foreign by T cells and antibodies? | Switch off the "ID flags" (HLA) that T cells use | *B2M*, *CIITA* |
| **2B. Autoimmune attack** | Can the cells survive the attack that caused the diabetes, including restarts from graft debris? | Small clusters and a pre-built blood supply shed less debris. Protection switches on with inflammation | *CXCL10* locus |
| **3. Early immune attack** | In the first hours, are the cells protected from natural killer cells, macrophages and blood clotting? | HLA-E and CD47 are intended shields; resting HLA-E in Arm 1B is below the model's assumed threshold and protection must be measured | *B2M* locus |
| **4. Cell stress** | Can the cells survive inflammation, the killer-cell toxin granzyme B, insulin-making stress and low oxygen? | SERPINB9 (blocks granzyme B) and PD-L1 ("back off" to T cells), switched on by inflammation | *CXCL10* locus |
| **5. Oxygen and safety** | Do the cells get oxygen for the first 3 days, and can they be removed on command? | An oxygen-releasing layer, pre-built vessels, and an iCasp9 safety switch | *AAVS1* locus |

*Table 1. The five tests. Test 2 has two parts, so the scoring model has six factors.*

## 3. Three designs

> **In short.** Nobody knows yet which way of hiding the cells works best, so the blueprint compares three: the lead, a matched alternative and a challenger.

<!--figure:blueprint-->

| <span class="sr-only">Aspect</span> | **Design A** | **Design B** | **Design X** |
| :-- | :-- | :-- | :-- |
| Idea | One design for most patients | Matched to the patient's immune type | The challenger: Design A plus one insulin-gene edit (scored); separate Stage-0 upgrades on paper |
| Edits | Four disruption/insertion loci; optional TYK2 prime-edit overlays are separate variants | B1: six loci plus an INS edit. B2: five loci, with or without a TYK2 prime edit | The same four loci as Design A, plus one INS base edit |
| ID flags | Switch off *B2M* and *CIITA*. Add HLA-E and CD47 | Switch off *HLA-A*, *HLA-B* and *CIITA*. Keep one matched *HLA-C* | The same as Design A |
| Other edits | *CXCL10*: reference SERPINB9–GSG-P2A–PD-L1 cassette. *AAVS1*: safety-switch candidate | B1 switches off TYK2 and adds an INS edit; B2 preserves TYK2 or proposes P1104A prime editing. Both propose a 2A-free protective cassette whose donor DNA is unresolved | Design A's *CXCL10* and *AAVS1* edits, plus *INS*: a base edit to the insulin signal sequence that also removes a hidden start signal |
| Main risk | Too little CD47 and HLA-E in the first hours. Attack through the patient's own immune cells | One *HLA-C* gene may not calm natural killer cells. More edits make manufacturing harder | An insulin-only edit cannot hide the other targets of the attack, or stop attack through the patient's own immune cells. One more edit to manufacture |
| Weakest test in the model | Test {{weakestA}} | Test {{weakestB}} | Test {{weakestX}} |

*Table 2. The three designs. Figure 1 shows Design A as a drawing.*

Design A is the lead design in the model and ranks first of {{designs}}. The B family retains matched *HLA-C* as a hypothesis for engaging inhibitory NK receptors ([Lin 2023](#ref-37264229)). The selected B scoring comparator ranks {{rankB}} of {{designs}}; that number is not a prediction for the unresolved 2A-free product.

**Design X is the challenger.** The scored grid version (Design A plus the insulin-gene base edit, on the baseline 119 µm oxygen layer) scores {{scoreX}} against {{scoreA}} for Design A on the overall score (children and adults counted equally; Table 3 shows the children's score) and ranks {{rankX}} of {{designs}}, tied with one other design; the separate Stage-0 upgrade bundle has no score. {{xCompare}} A challenger replaces the lead only if lab results show it is better, in a head-to-head comparison whose rules are written down first. The model's scores cannot settle that.

**Personalisation.** The program checks declared genotype inputs and reference edit instructions. Its population runs explore assumptions; they do not select a proven treatment for a person. A and B variants have separate product definitions and edit counts. Matched clinical products would require manufacturing, safety and regulatory evidence; no shared-platform approval or patient eligibility is established.

## 4. The edits, one by one

<a id="spec-edits"></a>

<a id="spec-b2m"></a>

### 4.1 *B2M*: ID flags off, two "don't attack me" signals on

The edit places two genes inside the *B2M* gene. Removing *B2M*'s own output switches off HLA class I, the flags that T cells use to recognise foreign cells ([Gornalusse 2017](#ref-28504668)). The two inserted genes are **HLA-E**, which calms natural killer cells ([Gornalusse 2017](#ref-28504668)), and **CD47**, which tells macrophages not to eat the cell ([Hu 2024](#ref-37156915)).

CD47 is inserted in a form anchored to the cell surface. Full-length CD47 sends signals inside the cell that can blunt insulin release ([Ghimire 2023](#ref-37820008)) and block new blood vessels, while the surface-anchored form separated macrophage protection from cell death and blocked vessel growth in non-islet immune, blood-stem-cell and endothelial models ([Xu 2024](#ref-38508139)); binding, membrane processing, phagocytosis and insulin secretion in stem-cell islets remain to be measured.

Two layouts are being compared. In the first, the two genes are read as one unit, joined by a short "2A" sequence. At 4,880 base pairs its repair template is too large for one AAV6 delivery virus, so it would need non-viral delivery. In the second, each gene has its own promoter and they face opposite directions, so there is no 2A joint and the template (3,974 base pairs) fits in one AAV6 virus. CD47 density in resting and inflammatory conditions is an assay endpoint; the 180,000 to 220,000 molecules-per-cell transition in [Hu 2024](#ref-37156915) was measured on virus-titrated primary human islets with clone CC2C6 and Quantibrite beads (while their engineered stem-cell islets exceeded 600,000), so a protective threshold has not been established for this product. In the current Arm 1B donor, an internal EEF1A1 promoter drives CD47 constitutively and an internal 5xISRE promoter drives HLA-E with inflammatory stimulation. Endogenous B2M read-through is not credited as productive HLA-E expression. The surface densities are unvalidated priors, and CD47 is not demonstrated to compensate for low resting HLA-E (rule GY-009). Stage-0 lab checks also track promoter DNA methylation (silencing) across maturation in the opposing-promoter layout and confirm that nearby genes at the *B2M* locus remain undisturbed.

<a id="spec-ciita"></a>

### 4.2 *CIITA*: the second set of flags off

Both copies are switched off, which removes HLA class II, the second set of ID flags ([Parent 2021](#ref-34407395)). Stage-0 RNA checks verify that switching *CIITA* off does not leave unintended splice forms or transcripts. Removing HLA class II does not stop the patient's own immune cells from picking up graft debris and presenting it to T cells, which is why the design also keeps clusters small and adds protection that switches on with inflammation (rule GY-010).

<a id="spec-cxcl10"></a>

### 4.3 *CXCL10*: protection that switches on with inflammation

Two protective genes are inserted at the *CXCL10* gene, so they switch on only when inflammation appears. **SERPINB9** blocks granzyme B, the toxin that killer cells fire. **PD-L1** is a "back off" signal for T cells. SERPINB9 is made first, then PD-L1. Stage-0 lab tests check that nearby inflammatory genes (*CXCL9* and *CXCL11*) and overlapping *ART3* transcripts stay undisturbed while keeping the repair template inside a single AAV6 delivery virus, and test whether PD-L1 shed into cell-free liquid around the cells ([Hira-Miyazawa 2018](#ref-29345283)) can calm a separate immune response on its own.

The design retains STAT1 because its proposed interferon-responsive trigger depends on that pathway. Switching STAT1 off while relying on that trigger is incompatible with the proposed mechanism, so the model blocks it: a design conflict, not a failed experiment (rule GY-001). [Sintov 2022](#ref-36055241) reports that targeting interferon-induced signals can help stem-cell islets survive, so the design has to choose between that and its own interferon trigger. One detail is unresolved: the flexible loop of SERPINB9 that grabs granzyme B cannot be modelled reliably by computer, so whether it works as designed needs a lab test.

<a id="spec-aavs1"></a>

### 4.4 *AAVS1*: the safety switch

A switch gene, iCasp9, is inserted at a "safe harbour" site called *AAVS1*, on both copies of the chromosome ([Wunderlich 2022](#ref-35795779)). AP1903 is intended to trigger cell death through the switch. Its promoter is intended for broad expression, but reliable expression and drug-triggered killing across endocrine, vascular, immature and off-target cells remain lab tests the switch has to pass ([Yagyu 2016](#ref-27626039)). A switch that worked only in mature beta cells would stay silent in immature or rogue cells and could not remove them (rule GY-002). The inserted element is the HNRNPA2B1-proximal 455-bp CpG-core candidate at GRCh38 chr7:26200580-26201034; the legacy CBX3 label is an alias, not proof of identity to the published CBX3-side fragment. Stage-0 lab tests compare four anti-silencing and orientation variants at *AAVS1* (including the published CBX3-side fragment and the 250-bp cHS4-derived variant) while checking host-gene (*PPP1R12C*) splicing and DNA methylation. Three crystal structures of the switch's separate parts (PDB 1BL4, 1JXQ and 1NW9) check local protein geometry, while whole-switch killing across every lineage remains a lab test. The proposed target is an escape bound of fewer than one in 100 million cells capable of regrowth, not a measured kill rate.

<a id="spec-designb"></a>

### 4.5 What Design B changes

The B family disrupts *HLA-A*, *HLA-B* and *CIITA* while retaining matched *HLA-C*. B1 additionally disrupts TYK2 and proposes an INS edit; B2 instead preserves TYK2 or proposes its P1104A prime edit. The differentiation penalties for switching off TYK2 are literature-anchored priors, not observations of this combined chassis ([Chandra 2022](#ref-36289205)). The proposed 2A-free protective cassette has no complete donor ledger. Existing Layer 2 B profiles are explicitly provisional P2A experimental comparators and cannot establish an exact B product's benefit. HLA-C-mediated protection, editing safety and manufacturing performance all remain unmeasured (rule GY-005; [Lin 2023](#ref-37264229)). Cutting *HLA-A* and *HLA-B* at the same time risks deleting or flipping the stretch of DNA between them (about 1.4 million letters), which holds *HLA-E* and the *HLA-C* copy Design B keeps. Design B therefore has to make the two edits one after the other, checking the cells in between, or use editors that do not cut both strands of the DNA.

<a id="spec-designx"></a>

### 4.6 What Design X changes

Design X keeps Design A's four edits and adds one: a base edit in the insulin gene (*INS*). A base edit changes a single letter of DNA without cutting both strands. This one alters the insulin signal sequence and silently removes a hidden start signal that can make a faulty insulin-like fragment, which T cells in people with type 1 diabetes have been reported to attack ([Kracht 2017](#ref-28263308)). The aim is to leave the graft's own insulin a harder target for the autoimmune attack (test 2B). It cannot hide the other proteins the attack targets (GAD65, IA-2 and ZnT8), or stop the patient's own immune cells passing on cell debris, so rule GY-010 stays on as a warning. Whether the edit helps, and whether insulin still works normally after it, is unmeasured.

The name Design X covers two separate ideas. The one above, with its insulin-gene edit, is the one the computer model scores. Separately, upgrades are proposed under the same name. They are not part of that score, none is built or measured, and they do not include the insulin-gene edit.

- **Redesigned "don't attack me" signals.** A new DNA switch and a slightly changed CD47 protein at the *B2M* locus, meant to be tested for a higher resting level of the HLA-E signal and for removing an unneeded sulphur group from CD47. HLA-E itself stays unchanged by default; a small change to stop the CD8 helper protein of killer T cells gripping it is an optional side test. This is a written proposal: its DNA is not built yet, so no level, yield or score exists.
- **A protective stem-cell line.** A starting line that already carries a natural variant of the insulin gene linked to a lower risk of type 1 diabetes ([van Tienhoven 2025](#ref-40112799)), alongside testing how a naturally protective *TYK2* variant ([Dendrou 2016](#ref-27807284)) behaves across the {{virtualPatients}}-patient simulation. Choosing a starting line is a selection step, not an edit. In the one mouse comparison reported for the insulin variant, it did not clearly change how many mice were cured, so any protection is unproven.
- **A layered gel around the graft.** While all three designs include temporary gel particles carrying clotting-control (SA-THBD, [Turan 2024](#ref-38709159)) and Fas-ligand (SA-FasL, [Headen 2018](#ref-29867165); [Lei 2022](#ref-35559682)) signals, the Stage-0 Design X proposal places the Fas-ligand particles strictly in an outer boundary ring around a thinner 100 µm central oxygen layer so they stay away from the beta cells. Because gel signals wash out over days, Stage-0 lab tests compare never-treated, gel-depleted and active grafts side by side for immune rebound, and test an optional complement shield (CD55) on the exact same edited cells while keeping the cell's own CD59 insulin-release machinery intact ([Golec 2022](#ref-35666870)).

Across all three designs, the zinc transporter gene *SLC30A8* (ZnT8) is kept intact until stem-cell islet yield and insulin output are measured. Four other proposed edits—thymidylate synthase (*TYMS*) nutrient control ([Sartori-Maldonado 2024](#ref-38867450)), tuning down *NLRC5* in Design B, switching on the cell's own *CD274* (PD-L1) promoter, and tuning down *TXNIP*—are held outside all core designs behind written Stage-0 pass rules.

<a id="spec-environment"></a>

## 5. The environment: oxygen and blood supply

> **In short.** A new graft has no blood vessels at first, so the design brings its own oxygen and vessels.

The cells are grown into clusters of 120 µm or less across, so oxygen can reach the centre. A graft would be a thin slab about 350 µm thick. It holds the clusters, pre-built blood-vessel fragments (the plan is to grow them from the same cell line, since stem cells can form blood vessels, [Wimmer 2019](#ref-30651639); the one measured result so far used fragments taken from fat tissue, [Aghazadeh 2021](#ref-34480863)), and a central layer that releases oxygen for the first 72 hours (calcium peroxide in silicone, with the enzyme catalase turning the by-product hydrogen peroxide into oxygen).

The margin is thin. In the baseline used for the scores, a 350 µm slab with a central layer about a third of its thickness leaves two outer bands of about 115 µm, a little narrower than the largest clusters (120 µm), and with pessimistic assumptions the model's oxygen at the middle of a cluster is low. The version of Design A planned for the Stage-0 lab tests, and the Design X proposals, thin the central layer to 100 µm, which leaves outer bands of 125 µm and caps clusters at 100 µm, packing the same calcium peroxide inventory into 46.39 wt% (23.45 vol%) beads instead of 31.25 wt% (13.86 vol%). Because the model's 68-hour oxygen-release half-life comes from a 25 wt% (10.55 vol%) solid silicone disk ([Pedraza 2012](#ref-22371586)) rather than catalase-coated microbeads ([Accolla 2023](#ref-36971050); [Ke 2022](#ref-35743287)), an 84-run sensitivity sweep tests faster and slower half-lives across multiple release laws and shows that the passing window narrows sharply when blood vessels connect late; each recipe's particle size, release law and half-life have to be measured in its implanted form, and none of this has been measured yet.

The tissue model couples oxygen supply and consumption, peroxide clearance, acid–base balance, cell viability and a proposed vascular contribution over 14 days, including joint sensitivity checks where blood vessels connect late and supply less oxygen alongside a zero-vessel lower bound. Its numerical outputs depend on declared geometry, boundary conditions, reaction parameters and spatial discretization. A slab-average or homogenized oxygen value cannot establish the oxygen level inside every discrete cluster. Surviving the 14-day low-oxygen window also does not guarantee normal hormone control afterwards ([Wang 2025](#ref-40404627)), so Stage-0 lab tests measure insulin and glucagon release during and after recovery before counting the working dose. Current values belong to the versioned tissue atlas and must be read with its sensitivity and numerical-convergence checks; none is an experimentally established safety margin.

A separate 24-hour hormone model explores the proposed beta/alpha/delta mixture, meals and exercise. Its glucose nadir and hormone dynamics are conditional scenario outputs; they do not prove protection from hypoglycaemia or validate insulin shut-off in a patient. Alongside pure beta-cell controls ([Perez-Frances 2024](#ref-39169271)), Stage-0 lab tests compare higher-beta cell mixes (70:20:10 to 80:10:10) against the 60:30:10 default, keeping 60:30:10 unless fresh batches confirm both clean insulin shut-off and low-sugar glucagon rescue.

## 6. The evidence behind it

The corpus contains {{studies}} study records, {{arms}} experimental and control groups and {{findings}} extracted findings. Alongside that scoring baseline, the expanded Type 1 Diabetes [Context–Evidence Graph](/ceg) maps {{cegStudies}} primary empirical studies, {{cegArms}} experimental and control groups, {{cegOutcomes}} structured outcomes and {{cegLinks}} blueprint links screened from {{cegScreened}} candidate records; design scores stay on the {{studies}}-study scoring set unless a proposal updates a model parameter or rule. Active empirical studies, superseded reports and other record classes are distinguished in the source data. Evidence records carry source pointers, and retained verbatim excerpts are checked against their source under the public quotation policy. Evidence against an idea is included alongside evidence for it. For example, CD47 protects against macrophages but can blunt insulin release. The blueprint was then checked at five layers: the literature, the DNA ({{constructs}} genomic reference constructs and sequence/grammar checks; AlphaGenome scores are neither published nor used as evidence, because its terms limit outputs to non-commercial use), the proteins ({{structures}} 3D structures, including AlphaFold models, covering {{proteinPairs}} protein pairs), tissue and body simulations, and a scenario program using {{virtualPatients}} synthetic population members. Sequence and DNA-grammar checks flag places for the lab to test; they cannot certify that an insertion leaves nearby genes, splicing or promoter activity undisturbed, so each core edit site carries direct RNA and DNA-methylation checks in Stage 0.

<a id="spec-scoring"></a>

## 7. How the designs are scored

Each design gets a score from 0 to 1 on each test. Because the tests run in series, the scores are multiplied. A penalty applies for each gene edit beyond four and for each base edit. Designs that contain a known dead end score zero. {{designs}} designs were scored: {{blocked}} scored zero and {{feasible}} remained.

<!--figure:scores-->

**These scores are not predictions.** {{assumptions}}% of the spread comes from starting assumptions built into the model, {{overlap}}% from the overlap between assumptions and findings, and only {{findingsShare}}% from published findings. They are a structured way to compare designs and to see where the weak points are, not a chance of success. Lab results will replace the assumptions.

<a id="spec-graveyard"></a>

## 8. The Idea Graveyard

{{rules}} rules encode incompatibilities and risks used by the scoring model ({{rulesBlock}} BLOCK and {{rulesWarn}} WARN rules). A BLOCK rule rejects a combination within that declared design framework; it does not establish failure in every possible biological context. Examples include removing STAT1 while depending on its interferon pathway, and relying on an insulin promoter to express the safety switch in immature cells. The full list is public, newest first, and anyone can add to it through the [Start here guide](/start).

<a id="spec-risks"></a>

## 9. Known risks and open questions

- **Hour-zero levels.** CD47 and HLA-E may be too low in the first hours, when natural killer cells and macrophages attack.
- **SERPINB9.** Whether its flexible loop blocks granzyme B as designed cannot be settled by computer.
- **Indirect attack.** Cells without HLA flags can still be attacked when the patient's own immune cells present their debris.
- **One *HLA-C* gene** may not calm natural killer cells (Design B).
- **Editing *HLA-A* and *HLA-B* together** (Design B) can delete or flip the DNA between them, including *HLA-E* and the *HLA-C* copy it keeps, so the edits have to be made one after the other.
- **An insulin-only edit** cannot hide the other targets of the autoimmune attack (Design X).
- **Thin oxygen margin and recovery** under pessimistic oxygen-release laws or late blood vessels, and surviving low oxygen does not guarantee normal insulin and glucagon control afterwards ([Wang 2025](#ref-40404627)).
- **Temporary gel signals wearing off.** Once clotting-control and Fas-ligand gel particles wash out over days, the immune system could rebound against the bare edited cells.
- **Insertion-site neighbours, splicing and silencing.** Adding genes at *B2M*, *CXCL10* and *AAVS1* or switching off *CIITA* could disturb nearby genes, host-gene splicing or promoter activity over time unless ruled out in edited cells.
- **Cross-talk between immune cell types.** Testing T cells, natural killer cells and macrophages in separate wells keeps each edit's readout clear, but could miss ways those cells amplify one another when combined ([Leite 2020](#ref-32668238)).
- **Many edits at once** may cause DNA rearrangements (adenine base editors did in [Wu 2024](#ref-39529170)) and favour cells with cancer-linked changes, so manufacturing needs deep sequencing checks.
- **The scores rest mostly on assumptions.** No multi-edit, stem-cell-derived islet has completed a multi-patient trial without immunosuppression.

## 10. What happens next

This is Stage 0 of 6: the blueprint itself. Lab testing, animal studies and a first human trial come later. We expect partner organisations, or anyone who takes the open blueprint, to carry them out. See the [roadmap](/roadmap). The blueprint is open to challenge. If you find a mistake or a better idea, the [Start here guide](/start) shows how to submit it, and accepted changes are recorded in the changelog above.
