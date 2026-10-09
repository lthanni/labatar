# Sum installer asset downloads across all published Labatar GitHub releases.
# Use GITHUB_TOKEN in the environment for higher API rate limits if needed.
$ErrorActionPreference = 'Stop'

$headers = @{
    Accept = 'application/vnd.github+json'
    'User-Agent' = 'Labatar-release-downloads'
}
if ($env:GITHUB_TOKEN) {
    $headers.Authorization = "Bearer $env:GITHUB_TOKEN"
}

$downloadsByVersion = [ordered]@{}
$page = 1
do {
    $uri = "https://api.github.com/repos/lthanni/labatar/releases?per_page=100&page=$page"
    $releases = Invoke-RestMethod -Uri $uri -Headers $headers

    foreach ($release in $releases) {
        if ($release.draft) { continue }

        $version = [string]$release.tag_name
        if (-not $downloadsByVersion.Contains($version)) {
            $downloadsByVersion[$version] = [long]0
        }

        foreach ($asset in $release.assets) {
            # v0.1.3 used dots; later installers use hyphens.
            if ($asset.name -match '^Labatar[-.]Setup[-.].+\.exe$') {
                $downloadsByVersion[$version] += [long]$asset.download_count
            }
        }
    }

    $page++
} while ($releases.Count -eq 100)

$total = [long]0
foreach ($version in $downloadsByVersion.Keys) {
    $count = [long]$downloadsByVersion[$version]
    $total += $count
    [pscustomobject]@{ Version = $version; Downloads = $count }
}
[pscustomobject]@{ Version = 'TOTAL'; Downloads = $total }
