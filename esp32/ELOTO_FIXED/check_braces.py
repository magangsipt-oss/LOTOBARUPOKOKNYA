with open(r'd:\KULIAH 1-8\FOLDER ELOTO\htdocs\PROJECT_ELOTO_NEW\esp32\ELOTO_FIXED\ELOTO_FIXED.ino', 'r', encoding='utf-8', errors='ignore') as f:
    lines = f.readlines()

balance = 0
for i, line in enumerate(lines):
    prev = balance
    for ch in line:
        if ch == '{':
            balance += 1
        elif ch == '}':
            balance -= 1
    # Check if a function just ended or if balance was 0 and became non-zero
    if prev > 0 and balance == 0:
        pass
    if i == len(lines) - 1:
        print(f'End of file line {i+1}, balance = {balance}')

# Find where balance doesn't return to 0 between functions
balance = 0
for i, line in enumerate(lines):
    for ch in line:
        if ch == '{':
            balance += 1
        elif ch == '}':
            balance -= 1
    if line.startswith('void ') or line.startswith('bool ') or line.startswith('String ') or line.startswith('int ') or line.startswith('uint8_t ') or line.startswith('WorkerInfo '):
        if '(' in line and balance != 1:
            print(f'Line {i+1} starts function but balance is {balance}: {line.strip()[:60]}')
