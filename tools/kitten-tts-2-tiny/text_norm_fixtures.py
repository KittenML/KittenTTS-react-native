#!/usr/bin/env python
"""Parity fixtures for the TypeScript ports of the Kitten TTS 2 Nano/Pico/Mini text front end:
src/tiny/frontend/english/TtsNorm.ts (kittenml's tts_norm.normalize) and
src/tiny/frontend/english/Num2Words.ts (the English num2words calls tts_norm and misaki make).

Writes tests/fixtures/kitten-tts-2-tiny-norm.json (or --out FILE) with Python's outputs:

    python -I tools/kitten-tts-2-tiny/text_norm_fixtures.py [--out FILE]

A case where Python raises is stored as {"error": "<ExceptionName>"}; the TS port must
throw a PyError with that name.
"""
from __future__ import annotations

import argparse
import json
import math
import random
import sys
from importlib.metadata import version
from pathlib import Path

from num2words import num2words
from kittenml.kittentts2_tiny.frontend.tts_norm import normalize

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "tests" / "fixtures" / "kitten-tts-2-tiny-norm.json"

# --------------------------------------------------------------------------- normalize

CURATED = [
    # tts_norm's own examples
    "It cost $5.99 at the store.",
    "Dr. Smith lives on St. Paul St.",
    "The meeting is at 3:45pm on 2026-10-13.",
    "NASA's budget rose 12% to $24.5B.",
    "Chapter IV, section 3b.",
    "Call 555-0123 ext. 42.",
    "He ran 5km in 22min.",
    "The temperature is -3°C today.",
    "e.g. apples, i.e. fruit, etc.",
    "She owns 1,234 books & 7 cats.",
    "Flight AA1234 departs from JFK at 07:05.",
    "Version 2.0.1 fixes 3/4 of the bugs.",
    "Revenue grew 150% to $1.2B in Q3 2025.",
    "Mix 250ml water with 1.5kg flour at 180°C.",
    "Visit https://example.com or email a@b.com.",
    "The 3rd of May, 1999 — see pages 10-15.",
    # times
    "3:45pm", "3:45 pm", "3:45 P.M.", "3:45p.m", "3:45 a.m.", "12:00 AM", "12:00 am.", "12:00 pm",
    "23:59", "00:00", "0:30", "0:00 am", "07:05", "14:30 yesterday", "24:00", "12:60", "9:05am",
    "13:00pm", "13:05 pm", "11:59 p.m. It was late.", "Meet at 3:45pm.", "Meet at 3:45pm. Then go.",
    "at 3:45pm. then go", 'at 3:45pm."', "at 3:45pm.  ", "at 3:45pm.\nNext", "10:00", "1:00", "12:00",
    "12:30", "6:07:45", "12:345", "The ratio is 3:1", "Note: this", "Score 2:0 at half time.",
    "Opens 9:00-17:30 daily", "At 5:5 pm", "at 10:10 PM.", "at 10:10 PM. Ⓐ", "at 10:10 PM. 𐐀x",
    # bare hours
    "9am", "9 PM", "11a.m.", "11a.m. Tomorrow", "11 a.m. tomorrow", "13pm", "0am", "9amazing",
    "12 pm.", "5 a.m.,", "4pm!", "Meet at 9am.", "Meet at 9am. Then", "Meet at 9am. then",
    "Meet at 9 a.m.", "at 9am.\n", "9AM", "9 Am", "10pm-11pm", "7 a.m. Next", "9amİ",
    # dates
    "2026-10-13", "on 2026-10-13.", "2026-13-01", "2026-1-5", "1999-12-31", "0999-01-01",
    "2100-01-01", "2026-10-32", "2026-00-10", "10/13/2026", "1/2/03", "12/31/99", "13/10/2026",
    "10/13/26", "1/1/49", "1/1/50", "5/6/123", "1/1/0005", "13.10.2026", "Oct 13", "Oct. 13",
    "October 13, 2026", "october 13 2026", "OCTOBER 3, 1066", "March 5,2000", "May 1, 2100",
    "June 31, 2026", "Aprİl 5, 2026", "the 21st of June", "Mon., Jan. 5", "Tues. Sept. 9",
    "Dec. 25th", "Sun. Mar. 1", "Weds. and Thurs.", "Feb. 29, 2024", "Sat.", "Jan.,",
    # money
    "$24.5B", "$24.5 B", "$1.2b", "$3T", "$5 million", "$5m", "$5M.", "$1", "$1.00", "$1.01",
    "$0.99", "$0.5", "$100", "$1,000", "$1,234,567.89", "$ 5", "$5.999", "-$5", "$-5", "£3.50",
    "€1,000", "¥500", "$12.345B", "$1.0K", "$3k", "$1,2,3", "$0.01", "$2.10", "$1.5 trillion",
    "$7Bn", "$1.00B", "$0.001", "$10.5k.", "$99,999.995", "$1,000,000,000,000", "costs $3.50/lb",
    "$12345678901234567890", "$12345678901234567890.5M", "$1.5", "$01", "$1,", "US$5",
    # percentages
    "12%", "12.5%", "100 %", "-3%", "50%-60%", "0.5% of 1,000", "%", "100%!",
    # units
    "5km", "5 km", "3.5 kg", "60 mph", "2 GB", "1 km", "1.0 km", "1 in", "1 ft", "5 ft", "1 lb",
    "2 lbs", "1 hr", "10 mins", "250ml", "1l", "5 L", "100 Hz", "2.4GHz", "3 kW", "1 mph",
    "1,000 km", "5km/h", "Hello, in the morning", "10 in a row", "1 sec", "1 ms", "5 min.",
    "1 min", "1 mins", "1 hrs", "1 KG", "1,0 km", "1.00 km", "12 oz", "1 Mb", "8 TB", "3 khz",
    "5 kph", "2mi", "1 mi", "-3°C", "-3 °C", "98.6°F", "−40°F", "20 ° C", "3.°C", "100°", "45°",
    "180°C", "25℃", "0°F", "-.5°C", ".°C", "-°C", "1.2.3°C", "5 °Celsius", "5°c",
    # fractions
    "3/4", "1/2", "1/3", "2/3", "1/4", "1/8", "5/8", "2/5", "1/10", "3/0", "1/100", "1000/3",
    "22/7", "0/5", "1/1", "11/12", "001/002", "½", "¼ cup", "3½",
    # phones
    "555-0123", "555-123-4567", "(415) 555-0123", "+1 415 555 0123", "1-800-555-0199",
    "415.555.0123", "call 555 0123 now", "1 415 555 0123", "12345-6789", "555-01234",
    "555 123 45678", "1-555-123-4567", "+44 20 7946 0958", "tel:555-0123", "555-0123.",
    # ordinals
    "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "103rd", "111th",
    "1000th", "1000000th", "2ND", "3Rd", "1th", "0th", "100th", "20th century", "the 90th",
    "1,000th", "12345678901234567890th",
    # roman numerals
    "Chapter IV", "chapter iv", "World War II", "world war i", "Henry VIII", "Part XII",
    "Part XIII", "Section V.", "Act III, Scene II", "Phase IIII", "Type I diabetes", "Class X",
    "appendix ix", "Step VI", "Stage II cancer", "Book VII", "Volume XI", "Table III",
    "Figure II", "react IV", "Louis XIV", "Chapter Ⅳ", "CHAPTER   V", "World  War II",
    "Chapter IVX", "chapter\tii", "Chapter ıv", "Chapter İV",
    # abbreviations
    "Dr. Smith", "St. Paul St.", "Mr. and Mrs. Jones", "vs.", "Bob vs Alice", "Bob vs. Alice",
    "etc.", "ext. 42", "approx. 5", "Prof. X", "Rev. Green", "Hon. member", "Mt. Everest",
    "Ft. Worth", "123 Main St.", "Main St. is busy", "Main St., Boston", "on St. Mark's Rd.",
    "5th Ave.", "Sunset Blvd.", "No. 5", "Nos. 3 and 4", "No. you can't", "Acme Inc.",
    "Acme Ltd.", "Acme Corp.", "John Jr.", "John Sr.", "fig. 3", "eq. 2", "Vol. 3",
    "pp. 10-20", "e.g. apples", "E.G. this", "i.e. that", "I.E. that", "ie. not", "eg. no",
    "e. g. spaced", "dept. of", "univ. of", "est. 1999", "avg. 5", "min. 3", "max. 10",
    "wks.", "yrs.", "appt. at 3", "incl. tax", "excl. VAT", "ref. 7", 'Main St."',
    "St. (Saint)", "the St.", '"Main St." he said', "ST. LOUIS", "MR. BIG", "mİn. value",
    "St.Paul", "St.  Paul", "No.5", "No. 5th", "vs.Bob", "VS", "canvas.", "Messrs. Smith",
    "Dr.", "dr. who", "etc.,", "etc...", "mins.", "hrs. later",
    # symbols
    "R&D", "a & b", "me@home", "1+1=2", "5 × 3", "10 ÷ 2", "a < b > c", "~5", "©2026",
    "Brand™", "§3", "C++", "x = y + z", "5 < 10", "50% & 25%", "@", "#hashtag", "a ~ b",
    # ranges
    "10-20", "1990-1995", "10 - 20", "10–20", "10—20", "pages 5-10", "1-2-3", "2020-21",
    "5 -10", "5- 10", "1-1000000", "100-200 people",
    # decimals / versions
    "3.14", "0.5", ".5", "2.50", "1234.5678", "1,234.56", "0.001", "100.0", "1.2.3", "v2.0",
    "v1.2.3", "version 10.15.7", "Python 3.12", "1e-7", "1e10", "3.0.", "4.5.6.7", "1.", "1..2",
    "0.000", "00.50", "1,2.3",
    # comma numbers
    "1,234,567", "1,234", "12,34", "1,000,000,000", "1,", ",5", "10,000 people",
    "1,234 books", "1,999", "1,,2",
    # big numbers / signs
    "1000000", "1000000000", "1000000000000", "1000000000000000", "12345678901234567890",
    "9007199254740993", "007", "0", "-5", "−5", "-0.5", "5-3", "x-5", "(-5)", "-5.5.5",
    "a-5", "3 - -5", "--5", ".-5", "1" + "0" * 305, "9" * 306, "1" + "0" * 306,
    "1" + "0" * 310, "1" * 4300,
    # urls / emails
    "Visit https://example.com/path?q=1.", "www.example.org", "http://a.b", "email a@b.com.",
    "john.doe+tag@mail.example.co.uk", "@handle", "foo@bar", "HTTPS://EXAMPLE.COM",
    "see www.x.com/a-1, ok", "user@host.com.", "a.b@c-d.e.f", "x@y.z5",
    # years
    "in 1999", "in 2000", "2005", "2026", "1066", "800", "1100", "1099", "2099", "2100",
    "10000", "1900s", "the '90s", "In 2026, sales grew.", "1999-2000", "AD 1000", "year 0001",
    # punctuation and spacing
    "Hello , world !", "Wait...what?", 'He said: "Go!"', "a;b", "a.b", "end.", "Really?!",
    "Mon.,", "x__y", "a*b", "a/b", "[1]", "{x}", "a|b", "a\\b", "a^2", "`code`",
    "a  b   c", "  leading", "trailing  ", "\ttab\nnewline", "e.g.,", "Hmm... ok.",
    "Yes.No", "One.Two.Three", "Hi!How?", "x , , y", "a ; b", ".,!?;", "\"quote\".", "(a).b",
    "", " ", "...", "-", "—", "a—b", "a – b", "1.5.", "?5",
    # unicode
    "café", "naïve", "ﬁle", "①②", "x²", "３:４５ｐｍ", "１２３", "١٢٣", "१२३", "٣.٥ kg",
    "a b", "Ⅳ", "℃", "€", "“quoted”", "‘single’", "it’s", "wait—what", "1–2", "…",
    "emoji 😀 5", "日本 3", "𝟓 apples", "Ⓐ", "x\u0085y", "a b", "١٢:٣٠ pm",
    "٢٠٢٦-١٠-١٣", "𑁧𑁨𑁩", "𑁧𑁨𑁩𑁪-𑁧-𑁨", "Ⅻ", "x﻿y", "​5", "ǅ5", "é 5",
    "Ö5", "ß 5 km", "İstanbul 5", "Straße 5", "α 3 β", "Ⅷ chapter", "١,٢٣٤", "$٥",
    "x\x1cy 5", "5\x1d km",
    # errors Python raises
    "1..2°C", "5 mİ away", "5 mı", "$" + "9" * 400 + "B", "1" + "0" * 310 + "th",
    "9" * 4301, "$" + "9" * 4301, "$1." + "9" * 4301,
    # mixed
    "On Mon., Jan. 5, 2026 at 9:30am, Dr. Lee (ext. 42) paid $1,250.50 for 3.5 kg of tea.",
    "Call +1 415 555 0123 or 555-0199 before 5pm; prices start at $0.99 (approx. 20% off).",
    "In 1999-2000 the Q3 revenue was $24.5B vs. $3.2B in 1066 AD.",
    "World War II ended in 1945; Chapter IV covers 1946-1950.",
    "Run 5km, then 3 mi at 60 mph... or 100 km/h!",
    "Version 2.0.1 (released 2026-10-13) fixes 3/4 of bugs & adds 1/3 more @ 50% speed.",
    "It's 23:59 on 12/31/1999 - see https://y2k.example.com for info@y2k.example.com.",
    "Temp: -3°C to 98.6°F; humidity 45%; wind 12 mph.",
    "The 1st, 2nd and 103rd items cost $5, $10 and $15.50 respectively.",
    "St. Paul St. is near Main St., 5th Ave. and Sunset Blvd. No. 7.",
    "Mr. Smith vs. Mrs. Jones, i.e. the case, e.g. this one, etc.",
    "Henry VIII had 6 wives; Louis XIV reigned 72 yrs.",
    "Buy 2 GB, 1 TB or 512 MB drives for $49.99, $99 or $19.",
    "It weighs 1 lb, 2 lbs, 1 oz and 1 kg.",
    "Scores: 3:1, 2:2 and 10:00 - 11:30 AM.",
]


def build_random(rng: random.Random) -> list[str]:
    """Seeded combinations of the pieces the rules react to, to catch drift."""
    def num() -> str:
        k = rng.randrange(12)
        if k == 0:
            return str(rng.randrange(10))
        if k == 1:
            return str(rng.randrange(100))
        if k == 2:
            return str(rng.randrange(1000, 3000))
        if k == 3:
            return f"{rng.randrange(1, 1000)},{rng.randrange(1000):03d}"
        if k == 4:
            return f"{rng.randrange(100)}.{rng.randrange(1000)}"
        if k == 5:
            return str(rng.randrange(10 ** rng.randrange(1, 25)))
        if k == 6:
            return "0" + str(rng.randrange(100))
        if k == 7:
            return f"{rng.randrange(1, 1000)},{rng.randrange(1000):03d},{rng.randrange(1000):03d}"
        if k == 8:
            return f".{rng.randrange(100)}"
        if k == 9:
            return str(rng.randrange(1, 13))
        if k == 10:
            return "".join(rng.choice("0123456789٠١٢٣٤٥٦٧٨٩") for _ in range(rng.randrange(1, 5)))
        return str(rng.randrange(1, 32))

    words = ["the", "a", "price", "is", "at", "on", "in", "and", "Paul", "Main", "Chapter",
             "World War", "part", "Henry", "Bob", "Alice", "St.", "Dr.", "Mr.", "vs", "vs.",
             "etc.", "e.g.", "i.e.", "ext.", "No.", "Mon.", "Jan.", "Oct", "October", "May",
             "approx.", "min.", "ft.", "IV", "II", "VIII", "XII", "x", "Q3", "AA", "café"]
    templates = [
        lambda: f"{num()}:{rng.randrange(0, 70):02d}{rng.choice(['', 'am', ' pm', ' A.M.', 'p.m.', ' PM.'])}",
        lambda: f"{num()}{rng.choice(['am', ' pm', 'a.m.', ' P.M', 'AM.'])}",
        lambda: f"{rng.randrange(1900, 2100)}-{rng.randrange(0, 14)}-{rng.randrange(0, 33)}",
        lambda: f"{rng.randrange(0, 14)}/{rng.randrange(0, 33)}/{rng.choice([rng.randrange(100), rng.randrange(1000, 2100)])}",
        lambda: f"{rng.choice(['January', 'march', 'DECEMBER', 'May', 'June'])} {rng.randrange(1, 32)}{rng.choice([',', ''])} {rng.randrange(1000, 2200)}",
        lambda: f"{rng.choice(['', '-'])}${num()}{rng.choice(['', 'B', ' m', 'K', 'T', ' million', 'b.'])}",
        lambda: f"{num()}{rng.choice(['%', ' %', 'km', ' kg', ' mph', ' GB', ' in', ' min', 'ms', ' lbs', 'L', ' l', 'Hz'])}",
        lambda: f"{rng.choice(['', '-', '−'])}{num()}{rng.choice(['°C', ' °F', '° C', '°'])}",
        lambda: f"{rng.randrange(0, 1000)}/{rng.randrange(0, 1000)}",
        lambda: f"{rng.choice(['', '+1 ', '1-', '('])}{rng.randrange(100, 1000)}{rng.choice([') ', '-', '.', ' '])}{rng.randrange(100, 1000)}{rng.choice(['-', '.', ' ', ''])}{rng.randrange(0, 100000)}",
        lambda: f"{num()}{rng.choice(['st', 'nd', 'rd', 'th', 'TH', 'Nd'])}",
        lambda: f"{rng.choice(['Chapter', 'world war', 'Part', 'Henry', 'type', 'STAGE', 'act'])} {rng.choice(['I', 'II', 'IV', 'ix', 'XII', 'XIII', 'v', 'IIII'])}",
        lambda: f"{num()}{rng.choice(['-', ' - ', '–', '—', ' -'])}{num()}",
        lambda: f"v{rng.randrange(20)}.{rng.randrange(20)}{rng.choice(['', '.' + str(rng.randrange(20))])}",
        lambda: f"{num()}{rng.choice(['K', 'M', 'B', 'T', ' B', 'k'])}",
        lambda: rng.choice(words),
        lambda: rng.choice(["&", "@", "+", "=", "×", "÷", "<", ">", "~", "°", "€", "£", "¥", "©", "§", ":", "/", "*", "_"]) + num(),
        lambda: num(),
    ]
    seps = [" ", " ", " ", ", ", ". ", "; ", "! ", "? ", "-", "/", ":", "", "\n", " (", ") ", " — ", "..."]
    out = []
    for _ in range(500):
        parts = [rng.choice(templates)() for _ in range(rng.randrange(1, 7))]
        s = ""
        for p in parts:
            s += p + rng.choice(seps)
        out.append(s.strip() if rng.random() < 0.7 else s)
    # character soup around the characters the rules key on
    alphabet = "0123456789.,:-/$%° apmAPMkgKMBTstndrhSIVXiviomf()+&@'\"!?;–—−١٢٣"
    for _ in range(400):
        out.append("".join(rng.choice(alphabet) for _ in range(rng.randrange(1, 28))))
    return out


def run_normalize(text: str) -> dict:
    try:
        return {"in": text, "out": normalize(text)}
    except Exception as e:  # noqa: BLE001 - the TS port must raise the same type
        return {"in": text, "error": type(e).__name__}


# --------------------------------------------------------------------------- num2words

def n2w(value, to: str) -> dict:
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            enc = repr(value)          # 'nan', 'inf', '-inf'
        else:
            enc = value                # JSON keeps a float's repr, JS reads the same double
        case = {"kind": "float", "value": enc, "to": to}
    else:
        case = {"kind": "int", "value": str(value), "to": to}
    try:
        case["out"] = num2words(value, to=to)
    except Exception as e:  # noqa: BLE001
        case["error"] = type(e).__name__
    return case


def build_num2words(rng: random.Random) -> list[dict]:
    ints = list(range(0, 125)) + [
        999, 1000, 1001, 1010, 1011, 1099, 1100, 1101, 1999, 2000, 2001, 2005, 2026, 9999,
        10000, 10001, 10101, 100000, 100001, 101000, 110000, 999999, 1000000, 1000001, 1000100,
        1001000, 1100000, 10 ** 9, 10 ** 9 + 1, 10 ** 12, 10 ** 15, 10 ** 18, 10 ** 21,
        2 ** 53, 2 ** 53 + 1, 2 ** 64, 10 ** 100, 10 ** 303, 10 ** 305, 10 ** 306 - 1, 10 ** 306,
        10 ** 400, 123456789, 987654321012, 12345678901234567890, -1, -10, -21, -100, -1001,
        -10 ** 12, -(10 ** 306),
    ]
    for _ in range(150):
        ints.append(rng.randrange(10 ** rng.randrange(1, 40)))
    for _ in range(20):
        ints.append(rng.randrange(10 ** 300, 10 ** 306))
    for _ in range(20):
        ints.append(-rng.randrange(10 ** rng.randrange(1, 20)))

    years = [0, 1, 9, 10, 99, 100, 101, 110, 800, 999, 1000, 1001, 1009, 1010, 1066, 1100,
             1200, 1900, 1901, 1905, 1910, 1999, 2000, 2001, 2005, 2009, 2010, 2026, 2099, 2100,
             2105, 9999, 10000, 12345, 10 ** 12, -1, -44, -500, -2000, -2026]
    years += [rng.randrange(0, 10000) for _ in range(80)]

    floats = [
        0.5, 3.14, 2.50, 1234.5678, 1e-7, 0.1, 0.2, 0.3, 0.1 + 0.2, 1.005, 2.675, 0.07, 100.001,
        123456.789, 0.000123, 1e-5, 1e-4, 1.5e-6, 1.5e-7, 0.25, 0.125, 9.99, 99.99, 1.1, 1.01,
        1.001, 0.999, 0.9999999999999999, 1 / 3, 2 / 3, 1e-300, 1e-308, 1e-309, 5e-324,
        2.2250738585072014e-308, 123.456e-3, 4503599627370495.5, 1234567.891, 0.30000000000000004,
        12345678.9, 0.12345678901234568, 3.141592653589793, 2.718281828459045,
        -0.5, -1.5, -0.0, 0.0, -2.25, -1234.5678, -1e-7, 3.0, 1.0, 100.0, -7.0,
        1e15, 9007199254740992.0, 9007199254740994.0, 1e16, 1.5e17, 1e20, 1e21, 1.2345678901234568e20,
        1e100, 1e305, 9.999e305, 1e306, 1.7976931348623157e308,
        float("nan"), float("inf"), float("-inf"),
    ]
    for _ in range(120):
        floats.append(round(rng.uniform(0, 10 ** rng.randrange(0, 8)), rng.randrange(1, 10)))
    for _ in range(60):
        floats.append(rng.uniform(0, 1) * 10 ** rng.randrange(-12, 6))
    for _ in range(60):
        e = rng.randrange(53, 1018)
        floats.append(float(rng.getrandbits(53) | (1 << 52)) * 2.0 ** (e - 52))
    for _ in range(20):
        floats.append(float(rng.randrange(1, 10 ** 15)) + 0.5)

    cases = []
    for v in ints:
        cases.append(n2w(v, "cardinal"))
    for v in ints[:125] + [v for v in ints[125:] if abs(v) < 10 ** 40 or v >= 10 ** 300] + [10 ** 306]:
        cases.append(n2w(v, "ordinal"))
    for v in years:
        cases.append(n2w(v, "year"))
    for v in floats:
        cases.append(n2w(v, "cardinal"))
    for v in [3.0, 3.5, -2.0, 0.0, -0.0, 12.0, 1e20, 1e305, float("nan"), float("inf"), 21.0]:
        cases.append(n2w(v, "ordinal"))
    for v in [1999.5, 2005.5, -44.0, 3.5, 2026.0, 1905.0, 0.0, -0.5, 1e20, 10000.0, 1066.25,
              float("nan"), float("inf")]:
        cases.append(n2w(v, "year"))
    return cases


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=OUT)
    args = ap.parse_args()
    rng = random.Random(20261013)
    inputs = list(dict.fromkeys(CURATED + build_random(rng)))
    data = {
        "_about": "Python outputs for the TS ports in src/tiny/frontend/english "
                  "(TtsNorm.ts, Num2Words.ts). Regenerate with "
                  "tools/kitten-tts-2-tiny/text_norm_fixtures.py.",
        "python": sys.version.split()[0],
        "num2words": version("num2words"),
        "normalize": [run_normalize(t) for t in inputs],
        "num2words_cases": build_num2words(rng),
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    errors = sum(1 for c in data["normalize"] if "error" in c)
    print(f"wrote {args.out}: {len(data['normalize'])} normalize cases ({errors} raise), "
          f"{len(data['num2words_cases'])} num2words cases")


if __name__ == "__main__":
    main()
