"""Deterministic claim checking for strategies, briefs, captions and narration.

Copy may only assert what the approved claims and enabled product features
support. The checker flags: measurements (decibels, percentages, durations)
absent from approved claims; clinical, certification, warranty, reimbursement
and tender language; superlatives; capabilities the product does not have
(GPS, autonomous driving, emergency alerts, app control); and any term tied to
a feature that is disabled or removed.
"""
from __future__ import annotations

import re

ALWAYS_FLAG = [
    (r"\b\d+(\.\d+)?\s?(db|dba|decibels?)\b", "Noise or loudness figure: no measured evidence exists for this."),
    (r"\bclinically\b|\bclinical(ly)? (proven|tested)\b|\bmedical[- ]grade\b|\bdoctor[- ]recommended\b",
     "Clinical claim: not established by any evidence on file."),
    (r"\b(cures?|treats?|therapeutic|heals?|prevents? (heat ?stroke|illness|injury))\b", "Health-outcome claim."),
    (r"\b(certified|certification|iso ?\d+|fda|ce[- ]marked|bis[- ]certified|approved by)\b",
     "Certification claim: no certification is on file."),
    (r"\b(warranty|guarantee[ds]?|money[- ]back)\b", "Warranty/guarantee claim: not on file."),
    (r"\b(reimburs\w*|insurance[- ]covered|subsid(y|ised|ized)|tender[- ]eligible|gem[- ]listed)\b",
     "Reimbursement or tender eligibility: not established."),
    (r"\b(gps|autonomous|self[- ]driving|emergency alerts?|sos\b|fall detection|app[- ]controlled|app control)\b",
     "Capability not in the product specification."),
    (r"\b(best|#1|number one|no\.? ?1|world'?s first|fastest|unbeatable|perfect)\b", "Unsupported superlative."),
    (r"\b(reliable|durable|long[- ]lasting|premium|top[- ]quality|high[- ]quality|trusted|proven)\b",
     "Quality claim without evidence on file."),
    (r"\b\d+(\.\d+)?\s?%", "Percentage figure must come from an approved claim."),
    (r"\b(\d+)\s?(hours?|hrs?|km|kilometers|minutes?|mins?)\b", "Performance figure must come from an approved claim."),
    (r"\b(disabled people|the disabled|wheelchair[- ]bound|confined to)\b", "Undignified or identity-first wording."),
]

FEATURE_TERMS = {
    "fan": [r"\bfan\b", r"\bcool(ing|s|er)?\b", r"\bbreeze\b", r"\bairflow\b"],
    "speech_amplification": [r"\bamplif\w*", r"\bspeech\b", r"\bvoice\b", r"\bmicrophone\b", r"\bspeaker\b",
                             r"\bheard\b", r"\bloud(er)?\b"],
    "connectivity": [r"\bconnected\b", r"\biot\b", r"\bbluetooth\b", r"\bwi-?fi\b", r"\bsmart\b"],
}


def check(text: str, *, approved_claims: list[str], enabled_features: list[str], disabled_features: list[str],
          prohibited: list[str] | None = None) -> list[dict]:
    issues: list[dict] = []
    if not text:
        return issues
    low = text.lower()
    approved_low = " ".join(c.lower() for c in approved_claims)
    for pattern, reason in ALWAYS_FLAG:
        for m in re.finditer(pattern, low, re.I):
            frag = m.group(0)
            if frag and frag in approved_low:
                continue  # stated verbatim in an approved claim
            issues.append({"term": frag, "reason": reason, "severity": "block"})
    for feat in disabled_features:
        for pattern in FEATURE_TERMS.get(feat, []):
            for m in re.finditer(pattern, low):
                issues.append({"term": m.group(0), "reason": f"Refers to the '{feat}' feature, which is not in this version.",
                               "severity": "block"})
    for phrase in prohibited or []:
        if phrase and phrase.lower() in low:
            issues.append({"term": phrase, "reason": "Listed as a prohibited exaggeration for this product.",
                           "severity": "block"})
    seen = set()
    out = []
    for i in issues:
        k = (i["term"], i["reason"])
        if k not in seen:
            seen.add(k)
            out.append(i)
    return out


def check_many(fields: dict[str, str], **kw) -> dict[str, list[dict]]:
    return {k: v for k, v in ((k, check(t, **kw)) for k, t in fields.items()) if v}
