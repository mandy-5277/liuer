cd /opt/liuer/server
echo "=== errors/exceptions ==="
pm2 logs liuer-server --lines 80 --nostream 2>&1 | grep -iE 'error|exception|undefined|cannot|throw|disconnect|reconnect|settle|game_over|判|负|竞' | tail -30
echo "=== last 15 raw ==="
pm2 logs liuer-server --lines 15 --nostream 2>&1 | tail -15
