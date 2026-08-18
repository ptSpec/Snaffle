from itertools import combinations

projects = {
    'A': (18, 3, 1, 1, 1),
    'B': (16, 2, 4, 1, 2),
    'C': (11, 3, 1, 0, 0),
    'D': (20, 2, 1, 4, 1),
    'E': (22, 4, 2, 2, 1),
    'F': (9,  0, 3, 0, 2),
    'G': (14, 2, 2, 1, 2),
    'H': (15, 2, 1, 3, 0),
    'I': (13, 3, 2, 0, 1),
    'J': (24, 4, 2, 1, 2),
    'K': (17, 3, 2, 3, 1),
    'L': (8,  0, 2, 0, 2),
}
# (value, Bk, Fe, Data, Des)

CAP = (9, 8, 7, 5)  # backend limited to 9 by the extra rule; Fe 8; Data 7; Des 5

best = []
best_val = -1
names = list(projects)

for r in range(0, len(names) + 1):
    for combo in combinations(names, r):
        s = set(combo)
        tot = [sum(projects[p][i] for p in s) for i in range(5)]
        val, bk, fe, da, de = tot
        # capacities (component-wise)
        if bk > CAP[0] or fe > CAP[1] or da > CAP[2] or de > CAP[3]:
            continue
        # at least 4 projects
        if len(s) < 4:
            continue
        # at least one project with Data/ML cost >= 3
        if not any(projects[p][3] >= 3 for p in s):
            continue
        # if D chosen, design total >= 4
        if 'D' in s and de < 4:
            continue
        # D requires B
        if 'D' in s and 'B' not in s:
            continue
        # E or J requires A
        if ('E' in s or 'J' in s) and 'A' not in s:
            continue
        # J requires I
        if 'J' in s and 'I' not in s:
            continue
        # F requires L
        if 'F' in s and 'L' not in s:
            continue
        # C and I mutually exclusive
        if 'C' in s and 'I' in s:
            continue
        # D and K mutually exclusive
        if 'D' in s and 'K' in s:
            continue
        if val > best_val:
            best_val = val
            best = [tuple(sorted(s))]
        elif val == best_val:
            best.append(tuple(sorted(s)))

print("Best value:", best_val)
for b in sorted(best):
    v = sum(projects[p][0] for p in b)
    bk = sum(projects[p][1] for p in b)
    fe = sum(projects[p][2] for p in b)
    da = sum(projects[p][3] for p in b)
    de = sum(projects[p][4] for p in b)
    print(f"{','.join(b)} -> value {v}, Bk {bk}, Fe {fe}, Data {da}, Des {de}")
