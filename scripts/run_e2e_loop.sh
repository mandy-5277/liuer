cd /opt/liuer/server
for i in 1 2 3 4 5 6 7 8; do
  node test_e2e_ws.js > /tmp/e2e_$i.txt 2>&1
  echo "RUN $i exit=$? fail=$(grep -c FAIL /tmp/e2e_$i.txt)"
done
echo "--- unique FAIL lines ---"
grep -h 'FAIL\|  - ' /tmp/e2e_*.txt | sort -u
