<?php
/**
 * Creates every FacturaScripts table up front.
 *
 * FacturaScripts creates a table lazily, when its model is first instantiated,
 * and each model's install() creates the tables it depends on first (some depend
 * on each other, e.g. customers and contacts). Through the API alone some tables
 * (e.g. "partidas") are never created, and a failed attempt is cached as
 * "checked". So we clear that cache and instantiate every core model once.
 * It also blanks the default logo (see below).
 */
define('FS_FOLDER', '/var/www/html');
require FS_FOLDER . '/vendor/autoload.php';
require FS_FOLDER . '/config.php';

use FacturaScripts\Core\Base\DataBase;
use FacturaScripts\Core\DbUpdater;
use FacturaScripts\Core\Kernel;

@unlink(FS_FOLDER . '/MyFiles/' . DbUpdater::FILE_NAME);
Kernel::init();
$db = new DataBase();
$db->connect();

$failed = [];
foreach (glob(FS_FOLDER . '/Core/Model/*.php') as $file) {
    $class = '\\FacturaScripts\\Dinamic\\Model\\' . basename($file, '.php');
    try {
        new $class();
    } catch (\Throwable $e) {
        $failed[] = basename($file, '.php') . ': ' . $e->getMessage();
    }
}

// Without a company logo FacturaScripts prints its own; a transparent image
// makes invoices look like those of a company without a logo instead.
$transparentPng = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=');
foreach (['/Dinamic/Assets/Images/horizontal-logo.png', '/Core/Assets/Images/horizontal-logo.png'] as $logo) {
    file_put_contents(FS_FOLDER . $logo, $transparentPng);
}

$missing = array_filter(
    array_map(fn($file) => basename($file, '.xml'), glob(FS_FOLDER . '/Core/Table/*.xml')),
    fn($table) => !$db->tableExists($table)
);
foreach ($failed as $line) {
    echo "model error: {$line}\n";
}
echo count($missing) === 0 ? "all tables ready\n" : 'missing tables: ' . implode(', ', $missing) . "\n";
exit(count($missing) === 0 ? 0 : 1);
