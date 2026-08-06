"""
AdvisorIQ Synthetic Data Pipeline
names.py — Realistic name and data pools for generation without external dependencies.
"""

FIRST_NAMES_M = [
    "James", "William", "Oliver", "George", "Harry", "Jack", "Noah", "Charlie",
    "Jacob", "Alfie", "Freddie", "Oscar", "Arthur", "Henry", "Leo", "Theo",
    "Thomas", "Alexander", "Joshua", "Samuel", "Daniel", "Michael", "David",
    "Robert", "Richard", "Andrew", "Edward", "Christopher", "Matthew", "Jonathan",
    "Benjamin", "Nicholas", "Patrick", "Anthony", "Stephen", "Peter", "Simon",
    "Mark", "Paul", "John", "Adam", "Ian", "Stuart", "Graham", "Colin",
    "Ravi", "Arjun", "Vikram", "Sanjay", "Mohammed", "Ahmed", "Ali", "Omar",
    "Chen", "Wei", "Ming", "Hiroshi", "Kenji", "Carlos", "Miguel", "Jose",
]

FIRST_NAMES_F = [
    "Olivia", "Emma", "Sophia", "Isabella", "Charlotte", "Amelia", "Mia",
    "Harper", "Evelyn", "Abigail", "Emily", "Elizabeth", "Sofia", "Avery",
    "Eleanor", "Grace", "Hannah", "Lillian", "Addison", "Aubrey", "Ellie",
    "Sarah", "Jennifer", "Amanda", "Jessica", "Lisa", "Karen", "Patricia",
    "Susan", "Margaret", "Catherine", "Helen", "Diana", "Claire", "Louise",
    "Rachel", "Rebecca", "Victoria", "Alexandra", "Samantha", "Laura",
    "Priya", "Deepa", "Anita", "Fatima", "Aisha", "Nadia", "Leila",
    "Mei", "Li", "Yuki", "Yoko", "Maria", "Ana", "Carmen", "Isabel",
]

LAST_NAMES = [
    "Smith", "Jones", "Williams", "Taylor", "Brown", "Davies", "Evans",
    "Wilson", "Thomas", "Roberts", "Johnson", "Lewis", "Walker", "Robinson",
    "Wood", "Thompson", "White", "Watson", "Jackson", "Wright", "Green",
    "Harris", "Cooper", "King", "Lee", "Martin", "Clarke", "James",
    "Morgan", "Hughes", "Edwards", "Hill", "Scott", "Morris", "Rogers",
    "Kelly", "Ward", "Price", "Bell", "Phillips", "Shaw", "Turner",
    "Patel", "Shah", "Kumar", "Singh", "Ali", "Khan", "Ahmed",
    "Chen", "Wang", "Liu", "Zhang", "Tanaka", "Yamamoto", "Garcia",
    "Martinez", "Anderson", "Campbell", "Mitchell", "Carter", "Parker",
    "Collins", "Stewart", "Murray", "Reid", "Grant", "Ferguson",
]

UK_CITIES = [
    "London", "Manchester", "Birmingham", "Leeds", "Edinburgh", "Bristol",
    "Sheffield", "Liverpool", "Glasgow", "Nottingham", "Southampton",
    "Oxford", "Cambridge", "Bath", "Cheltenham", "Surrey", "Hampshire",
    "Hertfordshire", "Essex", "Kent", "Berkshire", "Buckinghamshire",
]

TOPICS_DISCUSSED = [
    "portfolio review",
    "retirement planning",
    "estate planning",
    "tax planning",
    "market update",
    "goal progress",
    "insurance review",
    "new investment opportunity",
    "family financial planning",
    "cash flow review",
    "property discussion",
    "business exit planning",
    "inheritance planning",
    "risk tolerance review",
    "rebalancing",
    "next gen engagement",
    "philanthropic planning",
]

OUTCOME_OPTIONS = [
    "positive — follow up scheduled",
    "positive — action taken",
    "neutral — information provided",
    "neutral — client to consider",
    "negative — client concerned",
    "negative — complaint raised",
    "no response",
]
