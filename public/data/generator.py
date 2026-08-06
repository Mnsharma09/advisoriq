"""
AdvisorIQ Synthetic Data Pipeline
generator.py — Builds all 11 tables with correlated, realistic data.

Tables generated:
  1.  clients              — 150 client profiles with precomputed signal fields
  2.  interactions         — 18 months of advisor-client interaction history
  3.  portfolio_snapshots  — Monthly portfolio snapshots per client
  4.  life_events          — Life events with urgency and action flags
  5.  households           — Household groupings with engagement scores
  6.  goals                — Per-client financial goals with progress
  7.  product_holdings     — Product coverage per client with gap flags
  8.  referrals            — Referral relationships between clients
  9.  advisor_benchmarks   — Peer benchmark reference table
  10. daily_contact_log    — Precomputed last-contact per client per day
  11. client_scores        — Empty template for signal engine output

Run: python generator.py
Output: /output/ — JSON + CSV for all tables
"""

import random
import json
import csv
import os
from datetime import datetime, timedelta
from collections import defaultdict, Counter

import config
import names

random.seed(config.RANDOM_SEED)

# ── UTILITIES ─────────────────────────────────────────────────────────────────

def weighted_choice(d):
    keys = list(d.keys())
    weights = [d[k].get("weight", d[k]) if isinstance(d[k], dict) else d[k] for k in keys]
    return random.choices(keys, weights=weights, k=1)[0]

def rand_date(start_days_ago, end_days_ago=0):
    today = datetime.today()
    start = today - timedelta(days=max(start_days_ago, end_days_ago + 1))
    end   = today - timedelta(days=end_days_ago)
    delta = (end - start).days
    if delta <= 0:
        return start.strftime("%Y-%m-%d")
    return (start + timedelta(days=random.randint(0, delta))).strftime("%Y-%m-%d")

def rand_date_obj(start_days_ago, end_days_ago=0):
    today = datetime.today()
    start = today - timedelta(days=max(start_days_ago, end_days_ago + 1))
    end   = today - timedelta(days=end_days_ago)
    delta = (end - start).days
    if delta <= 0:
        return start
    return start + timedelta(days=random.randint(0, delta))

def days_ago(date_str):
    return (datetime.today() - datetime.strptime(date_str, "%Y-%m-%d")).days

def clamp(v, lo, hi):
    return max(lo, min(hi, v))

def uid(prefix, n):
    return f"{prefix}{str(n).zfill(4)}"

# ── TABLE 1: CLIENTS ──────────────────────────────────────────────────────────

def generate_clients(household_ids):
    clients = []
    for i in range(config.NUM_CLIENTS):
        cid = uid("C", i + 1)
        gender = random.choice(["M", "F"])
        first  = random.choice(names.FIRST_NAMES_M if gender == "M" else names.FIRST_NAMES_F)
        last   = random.choice(names.LAST_NAMES)

        age_band = weighted_choice(config.AGE_BANDS)
        age = random.randint(config.AGE_BANDS[age_band]["min"],
                             config.AGE_BANDS[age_band]["max"])

        life_stage = "Accumulation"
        for (lo, hi), stage in config.LIFE_STAGE_BY_AGE.items():
            if lo <= age <= hi:
                life_stage = stage

        aum_tier = weighted_choice(config.AUM_TIERS)
        aum = round(random.uniform(config.AUM_TIERS[aum_tier]["min"],
                                   config.AUM_TIERS[aum_tier]["max"]), -3)

        tenure_band = weighted_choice(config.TENURE_BANDS)
        tenure_years = round(random.uniform(config.TENURE_BANDS[tenure_band]["min"],
                                            config.TENURE_BANDS[tenure_band]["max"]), 1)

        if age >= 65:
            risk_opts, risk_w = ["conservative", "moderate"], [0.6, 0.4]
        elif age >= 55:
            risk_opts, risk_w = ["conservative", "moderate", "growth"], [0.3, 0.5, 0.2]
        else:
            risk_opts, risk_w = ["moderate", "growth", "aggressive"], [0.4, 0.4, 0.2]
        risk_tolerance = random.choices(risk_opts, weights=risk_w, k=1)[0]

        risk_map = {"conservative":(1,3), "moderate":(3,6), "growth":(5,8), "aggressive":(7,10)}
        lo, hi = risk_map[risk_tolerance]
        risk_score_current = round(clamp(random.uniform(lo-1.5, hi+1.5), 1, 10), 1)
        risk_score_target  = round(random.uniform(lo, hi), 1)

        estate_prob = 0.3
        if age >= 60 and aum >= 500_000: estate_prob = 0.55
        elif age >= 60:                   estate_prob = 0.45
        elif aum >= 1_000_000:            estate_prob = 0.60
        estate_docs_complete = random.random() < estate_prob

        insurance_adequate = random.random() < {"Accumulation":0.50,"Pre-retirement":0.60,"Retirement":0.70}.get(life_stage, 0.55)

        review_freq = {"Tier 1 — Ultra HNW":90,"Tier 2 — HNW":120,"Tier 3 — Affluent":180,"Tier 4 — Mass Affluent":365}
        last_review_days = random.randint(30,120) if "Tier 1" in aum_tier else \
                           random.randint(60,180) if "Tier 2" in aum_tier else \
                           random.randint(90,365)
        last_review_date = rand_date(last_review_days)
        next_review_date = (datetime.strptime(last_review_date, "%Y-%m-%d") +
                            timedelta(days=review_freq.get(aum_tier, 180))).strftime("%Y-%m-%d")
        review_overdue   = next_review_date < datetime.today().strftime("%Y-%m-%d")

        if life_stage == "Retirement" and age <= 67:
            life_stage_change_date = rand_date(365*(age-65), 365)
        elif life_stage == "Pre-retirement" and age >= 53:
            life_stage_change_date = rand_date(365*(age-50), 365*2)
        else:
            life_stage_change_date = None

        clients.append({
            "client_id":               cid,
            "full_name":               f"{first} {last}",
            "first_name":              first,
            "last_name":               last,
            "gender":                  gender,
            "age":                     age,
            "age_band":                age_band,
            "life_stage":              life_stage,
            "life_stage_change_date":  life_stage_change_date,
            "aum":                     aum,
            "aum_tier":                aum_tier,
            "tenure_years":            tenure_years,
            "risk_tolerance":          risk_tolerance,
            "risk_score_target":       risk_score_target,
            "risk_score_current":      risk_score_current,
            "estate_docs_complete":    estate_docs_complete,
            "insurance_adequate":      insurance_adequate,
            "last_review_date":        last_review_date,
            "next_review_date":        next_review_date,
            "review_overdue_flag":     review_overdue,
            "tax_year_end_flag":       random.random() < 0.25,
            "household_id":            random.choice(household_ids),
            "is_primary_in_household": random.random() < 0.7,
            "referral_source":         random.choice(["Existing client","Professional referral",
                                                       "Digital / website","Event / seminar",
                                                       "Employee benefit","Family member","Cold outreach"]),
            "segment_tag":             f"{life_stage} — {aum_tier.split('—')[0].strip()}",
            "city":                    random.choice(names.UK_CITIES),
            "advisor_id":              "ADV001",
            # Precomputed signal fields — populated after other tables are built
            "days_since_last_contact":      None,
            "latest_portfolio_drift_pct":   None,
            "open_commitment_count":        None,
            "product_gap_count":            None,
            "unactioned_life_event_flag":   None,
            "off_track_goal_count":         None,
            "nba_scenario_flag":            None,
            "nba_expected_rank":            None,
        })
    return clients


# ── INJECT SCENARIOS ──────────────────────────────────────────────────────────

def inject_scenarios(clients):
    injected = []
    tier12  = [c for c in clients if "Tier 1" in c["aum_tier"] or "Tier 2" in c["aum_tier"]]
    over60  = [c for c in clients if c["age"] >= 60 and c["aum"] >= 500_000 and not c["estate_docs_complete"]]
    any_c   = clients[:]
    hnw     = tier12[:]

    for scenario in config.INJECTED_SCENARIOS:
        sid   = scenario["scenario_id"]
        count = scenario["count"]

        if sid == "S001":
            pool = tier12 if len(tier12) >= count else any_c
            for c in random.sample(pool, min(count, len(pool))):
                c["nba_scenario_flag"] = sid
                c["nba_expected_rank"] = scenario["expected_rank"]
                c["last_review_date"]  = rand_date(120, 80)
                injected.append((c["client_id"], sid))

        elif sid == "S002":
            for c in random.sample(any_c, min(count, len(any_c))):
                c["nba_scenario_flag"] = sid
                c["nba_expected_rank"] = scenario["expected_rank"]
                injected.append((c["client_id"], sid))

        elif sid == "S003":
            pool = [c for c in clients if c["age"] >= 60 and c["aum"] >= 500_000]
            if len(pool) < count:
                for c in [x for x in clients if x["age"] >= 58][:count-len(pool)]:
                    c["age"] = random.randint(61, 75)
                    c["aum"] = random.uniform(500_000, 1_500_000)
                    pool.append(c)
            for c in random.sample(pool, min(count, len(pool))):
                c["estate_docs_complete"] = False
                c["nba_scenario_flag"] = sid
                c["nba_expected_rank"] = scenario["expected_rank"]
                injected.append((c["client_id"], sid))

        elif sid == "S004":
            for c in random.sample(any_c, min(count, len(any_c))):
                c["nba_scenario_flag"] = sid
                c["nba_expected_rank"] = scenario["expected_rank"]
                injected.append((c["client_id"], sid))

        elif sid == "S005":
            pool = hnw if len(hnw) >= count else any_c
            for c in random.sample(pool, min(count, len(pool))):
                c["nba_scenario_flag"] = sid
                c["nba_expected_rank"] = scenario["expected_rank"]
                injected.append((c["client_id"], sid))

    return clients, injected


# ── TABLE 2: INTERACTIONS ─────────────────────────────────────────────────────

def generate_interactions(clients):
    interactions = []
    iid = 1
    today_str = datetime.today().strftime("%Y-%m-%d")

    for client in clients:
        cid       = client["client_id"]
        tier      = client["aum_tier"]
        is_s001   = client.get("nba_scenario_flag") == "S001"
        freq_cfg  = config.CONTACT_FREQ_BY_TIER.get(tier, {"mean":1.0,"std":0.5})
        monthly   = max(0.1, random.gauss(freq_cfg["mean"], freq_cfg["std"]))
        total     = max(1, int(monthly * config.HISTORY_MONTHS))
        hist_days = config.HISTORY_MONTHS * 30

        dates = sorted([
            rand_date_obj(hist_days, 76 if is_s001 else 0)
            for _ in range(total)
        ])

        for dt in dates:
            int_type   = weighted_choice(config.INTERACTION_TYPES)
            initiated  = "advisor" if random.random() < 0.65 else "client"
            sentiment  = weighted_choice(config.SENTIMENT_WEIGHTS)
            dur_map    = {"Phone call":(10,30),"Email":(0,0),"In-person meeting":(45,90),
                          "Video call":(30,60),"Review meeting":(60,120)}
            lo2, hi2   = dur_map.get(int_type, (10,30))
            duration   = random.randint(lo2, hi2) if hi2 > 0 else 0
            topics     = "|".join(random.sample(names.TOPICS_DISCUSSED, random.randint(1,3)))

            if sentiment == "positive":
                outcome = random.choice(["positive — follow up scheduled","positive — action taken","neutral — information provided"])
            elif sentiment == "negative":
                outcome = random.choice(["negative — client concerned","negative — complaint raised","neutral — client to consider"])
            else:
                outcome = random.choice(["neutral — information provided","neutral — client to consider","positive — follow up scheduled"])

            commitment_made = random.random() < 0.35
            if commitment_made:
                commitment_fulfilled = random.random() < 0.72   # slightly lower — creates open commitments
                due_date = (dt + timedelta(days=random.randint(7,30))).strftime("%Y-%m-%d")
                # Some due dates are in the past and unfulfilled — realistic open items
                if due_date < today_str and not commitment_fulfilled:
                    commitment_fulfilled = False
            else:
                commitment_fulfilled = None
                due_date = None

            interactions.append({
                "interaction_id":        uid("I", iid),
                "client_id":             cid,
                "advisor_id":            "ADV001",
                "date":                  dt.strftime("%Y-%m-%d"),
                "type":                  int_type,
                "initiated_by":          initiated,
                "duration_minutes":      duration,
                "outcome":               outcome,
                "sentiment":             sentiment,
                "topics_discussed":      topics,
                "commitment_made":       commitment_made,
                "commitment_fulfilled":  commitment_fulfilled,
                "follow_up_created":     commitment_made and random.random() < 0.85,
                "follow_up_due_date":    due_date,
            })
            iid += 1

    return interactions


# ── TABLE 3: PORTFOLIO SNAPSHOTS ──────────────────────────────────────────────

def generate_portfolio_snapshots(clients):
    snapshots = []
    sid = 1
    alloc_map = {
        "conservative": {"equity":0.30,"bonds":0.50,"cash":0.20},
        "moderate":     {"equity":0.55,"bonds":0.35,"cash":0.10},
        "growth":       {"equity":0.75,"bonds":0.20,"cash":0.05},
        "aggressive":   {"equity":0.90,"bonds":0.08,"cash":0.02},
    }

    for client in clients:
        cid     = client["client_id"]
        aum     = client["aum"]
        target  = alloc_map.get(client["risk_tolerance"], alloc_map["moderate"])
        is_s001 = client.get("nba_scenario_flag") == "S001"
        is_s004 = client.get("nba_scenario_flag") == "S004"

        for m in range(config.HISTORY_MONTHS, 0, -1):
            snap_date = (datetime.today() - timedelta(days=m*30)).strftime("%Y-%m-%d")
            aum = round(aum * (1 + random.gauss(0.006, 0.035)), 2)

            # Realistic drift distribution — more variance, more clients above 10%
            if is_s001 and m <= 3:
                drift = round(random.uniform(14, 22), 1)    # forced high drift
            else:
                # Use lognormal-style: most clients have some drift, some have a lot
                base_drift = abs(random.gauss(0, 6))        # higher std = more above 10%
                drift = round(clamp(base_drift, 0, 25), 1)

            drift_dir = random.choice([1,-1])
            act_eq    = round(clamp(target["equity"] + drift_dir*drift/100, 0, 1), 3)
            act_bonds = round(clamp(1-act_eq-target["cash"], 0, 1), 3)
            act_cash  = round(clamp(1-act_eq-act_bonds, 0, 1), 3)

            if is_s004 and m <= 3:
                progress = round(random.uniform(15, 38), 1)
            else:
                progress = round(clamp(50 + (config.HISTORY_MONTHS-m)*1.5 + random.gauss(0,5), 5, 98), 1)

            snapshots.append({
                "snapshot_id":                  uid("PS", sid),
                "client_id":                    cid,
                "snapshot_date":                snap_date,
                "aum_value":                    aum,
                "target_allocation_equity":     target["equity"],
                "target_allocation_bonds":      target["bonds"],
                "target_allocation_cash":       target["cash"],
                "actual_allocation_equity":     act_eq,
                "actual_allocation_bonds":      act_bonds,
                "actual_allocation_cash":       act_cash,
                "drift_pct":                    drift,
                "goal_progress_pct":            progress,
                "ytd_return":                   round(random.gauss(0.055, 0.08), 4),
                "benchmark_return":             round(random.gauss(0.005, 0.025), 4),
                "risk_score":                   client["risk_score_current"],
            })
            sid += 1

    return snapshots


# ── TABLE 4: LIFE EVENTS ──────────────────────────────────────────────────────

def generate_life_events(clients):
    events = []
    eid = 1
    s002_ids = {c["client_id"] for c in clients if c.get("nba_scenario_flag") == "S002"}

    for client in clients:
        cid  = client["client_id"]
        hist = int(client["tenure_years"] * 365)
        n    = clamp(int(random.gauss(client["age"]/15, 1)), 0, 5)

        for j in range(n):
            etype   = weighted_choice(config.LIFE_EVENT_TYPES)
            urgency = config.LIFE_EVENT_TYPES[etype]["urgency"]

            if cid in s002_ids and j == 0:
                event_date   = rand_date(45, 30)
                aware        = False
                action_taken = False
            else:
                event_date   = rand_date(hist, 7)
                aware        = random.random() < 0.75
                action_taken = aware and random.random() < 0.80

            events.append({
                "event_id":        uid("E", eid),
                "client_id":       cid,
                "event_type":      etype,
                "event_date":      event_date,
                "urgency_level":   urgency,
                "advisor_aware":   aware,
                "action_taken":    action_taken,
                "days_since_event":days_ago(event_date),
            })
            eid += 1

    return events


# ── TABLE 5: HOUSEHOLDS ───────────────────────────────────────────────────────

def generate_households(household_ids, clients):
    households = []
    by_hh = defaultdict(list)
    for c in clients:
        by_hh[c["household_id"]].append(c)

    s005_ids = {c["client_id"] for c in clients if c.get("nba_scenario_flag") == "S005"}

    for hid in household_ids:
        members = by_hh.get(hid, [])
        if not members:
            continue
        primary   = next((m for m in members if m["is_primary_in_household"]), members[0])
        total_aum = sum(m["aum"] for m in members)
        any_s005  = any(m["client_id"] in s005_ids for m in members)

        if any_s005:
            wealth_transfer_flag = True
            next_gen_engaged     = False
        else:
            wealth_transfer_flag = primary["age"] >= 65 and total_aum >= 500_000 and random.random() < 0.40
            next_gen_engaged     = wealth_transfer_flag and random.random() < 0.50

        member_last_contact = {
            m["client_id"]: rand_date(60,0) if m == primary else rand_date(180,30)
            for m in members
        }

        households.append({
            "household_id":          hid,
            "primary_client_id":     primary["client_id"],
            "member_ids":            "|".join(m["client_id"] for m in members),
            "member_count":          len(members),
            "total_household_aum":   round(total_aum, 2),
            "engagement_score":      round(clamp(random.uniform(40,90), 0, 100), 1),
            "wealth_transfer_flag":  wealth_transfer_flag,
            "next_gen_engaged":      next_gen_engaged,
            "member_last_contact":   json.dumps(member_last_contact),
        })

    return households


# ── TABLE 6: GOALS ────────────────────────────────────────────────────────────

def generate_goals(clients):
    goals = []
    gid = 1
    s004_ids = {c["client_id"] for c in clients if c.get("nba_scenario_flag") == "S004"}
    primary_goal_map = {
        "Accumulation":    ["Education funding","Property purchase","Emergency fund"],
        "Pre-retirement":  ["Retirement income","Estate / legacy","Income protection"],
        "Retirement":      ["Retirement income","Estate / legacy","Charitable giving"],
    }

    for client in clients:
        cid    = client["client_id"]
        n      = random.randint(2,5) if "Tier 1" in client["aum_tier"] or "Tier 2" in client["aum_tier"] else random.randint(1,3)
        used   = set()

        for idx in range(n):
            if idx == 0:
                gtype = random.choice(primary_goal_map.get(client["life_stage"], ["Retirement income"]))
            else:
                remaining = [g for g in config.GOAL_TYPES if g not in used]
                if not remaining: break
                gtype = random.choice(remaining)
            used.add(gtype)

            years_to_target = max(1, (65-client["age"]+random.randint(-3,5)) if gtype=="Retirement income" else random.randint(2,20))
            target_date     = (datetime.today() + timedelta(days=years_to_target*365)).strftime("%Y-%m-%d")
            target_amount   = round(client["aum"] * random.uniform(0.3, 2.5), -3)

            if cid in s004_ids and idx == 0:
                progress    = round(random.uniform(15, 38), 1)
                target_date = (datetime.today() + timedelta(days=random.randint(300,900))).strftime("%Y-%m-%d")
                on_track    = False
            else:
                progress = round(random.uniform(20, 90), 1)
                elapsed  = clamp((1 - years_to_target/max(1,years_to_target+client["tenure_years"]))*100, 0, 100)
                on_track = progress >= elapsed * 0.85

            goals.append({
                "goal_id":              uid("G", gid),
                "client_id":            cid,
                "goal_type":            gtype,
                "target_amount":        target_amount,
                "current_progress_pct": progress,
                "target_date":          target_date,
                "on_track":             on_track,
                "last_reviewed_date":   rand_date(180, 0),
                "priority_rank":        idx + 1,
                "years_to_target":      years_to_target,
            })
            gid += 1

    return goals


# ── TABLE 7: PRODUCT HOLDINGS ─────────────────────────────────────────────────

def generate_product_holdings(clients):
    holdings = []
    hid = 1

    for client in clients:
        cid      = client["client_id"]
        base_prob = config.PRODUCT_PROB_BY_TIER.get(client["aum_tier"], 0.40)
        age      = client["age"]

        for product in config.PRODUCT_TYPES:
            prob = base_prob
            if product in ["estate_plan","trust"] and age < 50:         prob *= 0.3
            elif product in ["estate_plan","trust"] and age >= 60:       prob *= 1.4
            if product == "mortgage" and age >= 65:                      prob *= 0.2
            elif product == "mortgage" and age < 45:                     prob *= 1.3
            if product == "tax_wrapper_pension":                         prob *= 1.2
            prob = clamp(prob, 0, 0.95)
            held = random.random() < prob

            flagged = False
            if not held:
                if product == "insurance_life" and 40 <= age < 70:       flagged = random.random() < 0.6
                elif product == "estate_plan" and age >= 55:              flagged = not client["estate_docs_complete"]
                elif product == "tax_wrapper_isa":                        flagged = random.random() < 0.4
                elif product == "insurance_protection" and age < 60:      flagged = random.random() < 0.5

            holdings.append({
                "holding_id":       uid("PH", hid),
                "client_id":        cid,
                "product_type":     product,
                "held":             held,
                "start_date":       rand_date(int(client["tenure_years"]*365)) if held else None,
                "review_due_date":  rand_date(365,-180) if held else None,
                "flagged_as_gap":   flagged,
            })
            hid += 1

    return holdings


# ── TABLE 8: REFERRALS ────────────────────────────────────────────────────────

def generate_referrals(clients):
    referrals = []
    rid       = 1
    client_ids = [c["client_id"] for c in clients]
    pool       = [c for c in clients if c["referral_source"] == "Existing client" or c["tenure_years"] > 5]

    for client in random.sample(pool, min(len(pool), int(config.NUM_CLIENTS*0.20))):
        for _ in range(random.randint(1,3)):
            referred = random.choice(client_ids)
            if referred == client["client_id"]: continue
            converted = random.random() < 0.65
            ref_date  = rand_date(int(client["tenure_years"]*365), 30)

            referrals.append({
                "referral_id":           uid("R", rid),
                "referring_client_id":   client["client_id"],
                "referred_client_id":    referred,
                "referral_date":         ref_date,
                "converted":             converted,
                "conversion_date":       rand_date(days_ago(ref_date), 0) if converted else None,
            })
            rid += 1

    return referrals


# ── TABLE 9: ADVISOR BENCHMARKS ───────────────────────────────────────────────

def generate_advisor_benchmarks():
    return [{
        "metric_name":      k,
        "peer_average":     v,
        "top_quartile":     round(v*1.35, 3),
        "bottom_quartile":  round(v*0.65, 3),
        "source":           "Industry benchmark — Capgemini / Cerulli 2024",
        "last_updated":     "2024-12-01",
    } for k, v in config.PEER_BENCHMARKS.items()]


# ── TABLE 10: DAILY CONTACT LOG ───────────────────────────────────────────────

def generate_daily_contact_log(clients, interactions):
    """
    Precomputed per-client contact summary.
    One row per client — fast lookup for signal engine.
    Avoids scanning full interactions table on every signal computation.
    """
    log = []
    today = datetime.today()

    # Group interactions by client
    by_client = defaultdict(list)
    for i in interactions:
        by_client[i["client_id"]].append(i["date"])

    for client in clients:
        cid   = client["client_id"]
        dates = sorted(by_client.get(cid, []))

        last_contact       = dates[-1] if dates else None
        days_since         = days_ago(last_contact) if last_contact else 999
        first_contact      = dates[0] if dates else None
        total_interactions = len(dates)

        # Count by type
        client_ints = [i for i in interactions if i["client_id"] == cid]
        type_counts = Counter(i["type"] for i in client_ints)
        advisor_initiated = sum(1 for i in client_ints if i["initiated_by"] == "advisor")
        client_initiated  = sum(1 for i in client_ints if i["initiated_by"] == "client")

        # Response rate (client-initiated / total)
        response_rate = round(client_initiated / max(1, total_interactions), 3)

        # Avg sentiment score (positive=1, neutral=0, negative=-1)
        sent_map  = {"positive":1, "neutral":0, "negative":-1}
        sentiments = [sent_map.get(i["sentiment"], 0) for i in client_ints]
        avg_sentiment = round(sum(sentiments)/max(1,len(sentiments)), 3)

        # Contact in last 30 / 60 / 90 days
        contact_30  = sum(1 for d in dates if days_ago(d) <= 30)
        contact_60  = sum(1 for d in dates if days_ago(d) <= 60)
        contact_90  = sum(1 for d in dates if days_ago(d) <= 90)

        # Open overdue commitments
        open_commitments = sum(
            1 for i in client_ints
            if i["commitment_made"]
            and i["commitment_fulfilled"] == False
            and i["follow_up_due_date"]
            and i["follow_up_due_date"] < today.strftime("%Y-%m-%d")
        )

        # Avg days between contacts
        if len(dates) >= 2:
            gaps = [(datetime.strptime(dates[k+1],"%Y-%m-%d") -
                     datetime.strptime(dates[k],"%Y-%m-%d")).days
                    for k in range(len(dates)-1)]
            avg_gap = round(sum(gaps)/len(gaps), 1)
        else:
            avg_gap = None

        log.append({
            "client_id":                    cid,
            "advisor_id":                   "ADV001",
            "last_contact_date":            last_contact,
            "days_since_last_contact":      days_since,
            "first_contact_date":           first_contact,
            "total_interactions_18m":       total_interactions,
            "advisor_initiated_count":      advisor_initiated,
            "client_initiated_count":       client_initiated,
            "response_rate":                response_rate,
            "avg_sentiment_score":          avg_sentiment,
            "contacts_last_30_days":        contact_30,
            "contacts_last_60_days":        contact_60,
            "contacts_last_90_days":        contact_90,
            "open_overdue_commitments":     open_commitments,
            "avg_days_between_contacts":    avg_gap,
            "last_updated":                 today.strftime("%Y-%m-%d"),
        })

    return log


# ── TABLE 11: CLIENT SCORES (empty template) ──────────────────────────────────

def generate_client_scores_template(clients):
    """
    Empty template — populated by the signal engine (next step).
    Included here so the schema is defined and the file exists.
    """
    return [{
        "client_id":                    c["client_id"],
        "advisor_id":                   "ADV001",
        "score_date":                   datetime.today().strftime("%Y-%m-%d"),
        # Dimension scores (0-100)
        "relationship_score":           None,
        "portfolio_score":              None,
        "household_score":              None,
        "book_score":                   None,
        "advisor_performance_score":    None,
        # Signal values
        "days_since_contact":           None,
        "portfolio_drift_pct":          None,
        "goal_progress_pct":            None,
        "product_gap_count":            None,
        "life_event_urgency":           None,
        # Multipliers
        "interaction_multiplier":       None,
        "aum_multiplier":               None,
        # Final score
        "nba_score":                    None,
        "nba_rank":                     None,
        "primary_urgency_reason":       None,
        "recommended_action":           None,
        # Validation
        "nba_scenario_flag":            c.get("nba_scenario_flag"),
        "nba_expected_rank":            c.get("nba_expected_rank"),
        "score_validated":              None,
    } for c in clients]


# ── BACKFILL PRECOMPUTED FIELDS ON CLIENTS ────────────────────────────────────

def backfill_client_signals(clients, interactions, snapshots, goals,
                            holdings, life_events, daily_log):
    """
    Populate the precomputed signal fields on each client row.
    Makes signal engine computation faster — reads one row instead of joining tables.
    """
    today_str = datetime.today().strftime("%Y-%m-%d")

    # Index daily log
    log_by_client = {row["client_id"]: row for row in daily_log}

    # Latest portfolio snapshot per client
    latest_snap = {}
    for s in snapshots:
        cid = s["client_id"]
        if cid not in latest_snap or s["snapshot_date"] > latest_snap[cid]["snapshot_date"]:
            latest_snap[cid] = s

    # Product gaps per client
    gap_count = Counter()
    for h in holdings:
        if h["flagged_as_gap"]:
            gap_count[h["client_id"]] += 1

    # Off-track goals per client
    off_track = Counter()
    for g in goals:
        if not g["on_track"]:
            off_track[g["client_id"]] += 1

    # Unactioned high-urgency life events
    unactioned = set()
    for e in life_events:
        if not e["action_taken"] and e["urgency_level"] == "high":
            unactioned.add(e["client_id"])

    for c in clients:
        cid = c["client_id"]
        log = log_by_client.get(cid, {})
        snap = latest_snap.get(cid, {})

        c["days_since_last_contact"]    = log.get("days_since_last_contact", 999)
        c["latest_portfolio_drift_pct"] = snap.get("drift_pct")
        c["open_commitment_count"]      = log.get("open_overdue_commitments", 0)
        c["product_gap_count"]          = gap_count.get(cid, 0)
        c["unactioned_life_event_flag"] = cid in unactioned
        c["off_track_goal_count"]       = off_track.get(cid, 0)

    return clients


# ── SAVE HELPERS ──────────────────────────────────────────────────────────────

def save_table(data, name):
    os.makedirs(config.OUTPUT_DIR, exist_ok=True)
    if not data:
        return

    if "json" in config.OUTPUT_FORMATS:
        path = os.path.join(config.OUTPUT_DIR, f"{name}.json")
        with open(path, "w") as f:
            json.dump(data, f, indent=2 if config.PRETTY_JSON else None, default=str)
        print(f"  ✓ {name}.json ({len(data):,} rows)")

    if "csv" in config.OUTPUT_FORMATS:
        path = os.path.join(config.OUTPUT_DIR, f"{name}.csv")
        with open(path, "w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=data[0].keys())
            writer.writeheader()
            writer.writerows(data)
        print(f"  ✓ {name}.csv  ({len(data):,} rows)")


# ── MAIN ──────────────────────────────────────────────────────────────────────

def main():
    print("\n" + "="*58)
    print("  AdvisorIQ Synthetic Data Pipeline")
    print("="*58)

    os.makedirs(config.OUTPUT_DIR, exist_ok=True)

    print(f"\n[1/11] Household IDs...")
    household_ids = [uid("H", i) for i in range(1, config.NUM_HOUSEHOLDS + 1)]

    print(f"[2/11] {config.NUM_CLIENTS} client profiles...")
    clients = generate_clients(household_ids)

    print(f"[3/11] Injecting {sum(s['count'] for s in config.INJECTED_SCENARIOS)} ground truth scenarios...")
    clients, injected = inject_scenarios(clients)

    print(f"[4/11] Interaction history ({config.HISTORY_MONTHS} months)...")
    interactions = generate_interactions(clients)

    print(f"[5/11] Portfolio snapshots...")
    snapshots = generate_portfolio_snapshots(clients)

    print(f"[6/11] Life events...")
    life_events = generate_life_events(clients)

    print(f"[7/11] Households...")
    households = generate_households(household_ids, clients)

    print(f"[8/11] Goals + product holdings...")
    goals    = generate_goals(clients)
    holdings = generate_product_holdings(clients)

    print(f"[9/11] Referrals + benchmarks...")
    referrals   = generate_referrals(clients)
    benchmarks  = generate_advisor_benchmarks()

    print(f"[10/11] Daily contact log (precomputed)...")
    daily_log = generate_daily_contact_log(clients, interactions)

    print(f"[11/11] Backfilling precomputed signal fields on clients...")
    clients = backfill_client_signals(clients, interactions, snapshots,
                                      goals, holdings, life_events, daily_log)

    scores_template = generate_client_scores_template(clients)

    print(f"\nSaving all tables...")
    save_table(clients,          "clients")
    save_table(interactions,     "interactions")
    save_table(snapshots,        "portfolio_snapshots")
    save_table(life_events,      "life_events")
    save_table(households,       "households")
    save_table(goals,            "goals")
    save_table(holdings,         "product_holdings")
    save_table(referrals,        "referrals")
    save_table(benchmarks,       "advisor_benchmarks")
    save_table(daily_log,        "daily_contact_log")
    save_table(scores_template,  "client_scores")

    # ── FINAL SUMMARY ────────────────────────────────────────────────────────
    total_rows = (len(clients)+len(interactions)+len(snapshots)+len(life_events)+
                  len(households)+len(goals)+len(holdings)+len(referrals)+
                  len(benchmarks)+len(daily_log)+len(scores_template))

    print(f"\n{'─'*58}")
    print(f"  {'Table':<28} {'Rows':>8}")
    print(f"{'─'*58}")
    for name, data in [
        ("clients",            clients),
        ("interactions",       interactions),
        ("portfolio_snapshots",snapshots),
        ("life_events",        life_events),
        ("households",         households),
        ("goals",              goals),
        ("product_holdings",   holdings),
        ("referrals",          referrals),
        ("advisor_benchmarks", benchmarks),
        ("daily_contact_log",  daily_log),
        ("client_scores",      scores_template),
    ]:
        print(f"  {name:<28} {len(data):>8,}")
    print(f"{'─'*58}")
    print(f"  {'TOTAL':28} {total_rows:>8,}")

    print(f"\n  Scenarios injected:")
    for s in config.INJECTED_SCENARIOS:
        n = sum(1 for c in clients if c.get("nba_scenario_flag") == s["scenario_id"])
        print(f"    {s['scenario_id']} — {s['type']}: {n} clients → expected {s['expected_rank']}")

    # Signal readiness
    print(f"\n  Signal readiness:")
    print(f"    Contact gap > 60 days:          {sum(1 for c in clients if (c['days_since_last_contact'] or 0) > 60)}")
    print(f"    Portfolio drift > 10%:           {sum(1 for c in clients if (c['latest_portfolio_drift_pct'] or 0) > 10)}")
    print(f"    Open overdue commitments:        {sum(1 for c in clients if (c['open_commitment_count'] or 0) > 0)}")
    print(f"    Product gaps (2+):               {sum(1 for c in clients if (c['product_gap_count'] or 0) >= 2)}")
    print(f"    Unactioned life events:          {sum(1 for c in clients if c['unactioned_life_event_flag'])}")
    print(f"    Off-track goals:                 {sum(1 for c in clients if (c['off_track_goal_count'] or 0) > 0)}")
    print(f"    Review overdue:                  {sum(1 for c in clients if c['review_overdue_flag'])}")
    print(f"\n  Output: /{config.OUTPUT_DIR}/ — JSON + CSV, ready for AdvisorIQ signal engine\n")


if __name__ == "__main__":
    main()
