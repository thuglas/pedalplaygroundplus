# Publishes Pedal Playground+ to AWS: a private S3 bucket served through CloudFront (HTTPS).
# The first run creates the bucket and the CloudFront distribution; later runs upload only
# what changed and clear CloudFront's cache so friends see the new version.
#
#   powershell -ExecutionPolicy Bypass -File deploy-aws.ps1
#
# Needs the AWS CLI, signed in (aws login, aws configure, or aws configure sso).

param(
	[string]$Profile = "",
	[string]$Region = "us-east-1"
)

$ErrorActionPreference = "Stop"
$Name = "pedalplaygroundplus"
Set-Location $PSScriptRoot

$awsExe = (Get-Command aws -ErrorAction SilentlyContinue).Source
if (-not $awsExe) { $awsExe = "C:\Program Files\Amazon\AWSCLIV2\aws.exe" }

function Aws {
	$extra = @("--region", $Region, "--output", "json")
	if ($Profile) { $extra += @("--profile", $Profile) }
	$out = & $awsExe @args @extra
	if ($LASTEXITCODE -ne 0) { throw "aws $($args -join ' ') failed" }
	# s3 sync/cp print text, everything else JSON
	if ($out -and $args[0] -ne "s3") { return ($out -join "`n") | ConvertFrom-Json }
}

# True when the command succeeds; its errors (e.g. "Not Found") are not shown
function AwsSucceeds {
	$extra = @("--region", $Region)
	if ($Profile) { $extra += @("--profile", $Profile) }
	$ErrorActionPreference = "Continue"
	& $awsExe @args @extra 2>&1 | Out-Null
	return $LASTEXITCODE -eq 0
}

# JSON for the CLI goes through a file (no BOM), which avoids PowerShell's quoting rules
function JsonFile($object) {
	$path = Join-Path $env:TEMP ("$Name-" + [guid]::NewGuid() + ".json")
	[IO.File]::WriteAllText($path, ($object | ConvertTo-Json -Depth 20), (New-Object Text.UTF8Encoding $false))
	return "file://$path"
}

$account = (Aws sts get-caller-identity).Account
$bucket = "$Name-$account"
Write-Host "AWS account $account, bucket $bucket"

# 1. Bucket (private: new buckets block all public access; only CloudFront can read it)
if (-not (AwsSucceeds s3api head-bucket --bucket $bucket)) {
	Write-Host "Creating bucket $bucket"
	if ($Region -eq "us-east-1") { Aws s3api create-bucket --bucket $bucket | Out-Null }
	else { Aws s3api create-bucket --bucket $bucket --create-bucket-configuration "LocationConstraint=$Region" | Out-Null }
	Aws s3api put-public-access-block --bucket $bucket --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true" | Out-Null
}

# 2. CloudFront distribution (found again by its comment)
$dist = (Aws cloudfront list-distributions).DistributionList.Items | Where-Object { $_.Comment -eq $Name } | Select-Object -First 1
if (-not $dist) {
	Write-Host "Creating CloudFront distribution (takes a few minutes to go live)"
	$oac = (Aws cloudfront list-origin-access-controls).OriginAccessControlList.Items | Where-Object { $_.Name -eq $Name } | Select-Object -First 1
	if (-not $oac) {
		$oac = (Aws cloudfront create-origin-access-control --origin-access-control-config (JsonFile @{
			Name = $Name; Description = "Pedal Playground+ bucket"; SigningProtocol = "sigv4"; SigningBehavior = "always"; OriginAccessControlOriginType = "s3"
		})).OriginAccessControl
	}
	$originDomain = "$bucket.s3.$Region.amazonaws.com"
	$config = @{
		CallerReference = "$Name-" + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
		Comment = $Name
		Enabled = $true
		DefaultRootObject = "index.html"
		PriceClass = "PriceClass_100"
		HttpVersion = "http2and3"
		Origins = @{ Quantity = 1; Items = @(@{
			Id = "s3"; DomainName = $originDomain; OriginAccessControlId = $oac.Id
			S3OriginConfig = @{ OriginAccessIdentity = "" }
		}) }
		DefaultCacheBehavior = @{
			TargetOriginId = "s3"
			ViewerProtocolPolicy = "redirect-to-https"
			Compress = $true
			CachePolicyId = "658327ea-f89d-4fab-a63d-7e88639e58f6"  # Managed-CachingOptimized
			AllowedMethods = @{ Quantity = 2; Items = @("GET", "HEAD"); CachedMethods = @{ Quantity = 2; Items = @("GET", "HEAD") } }
		}
	}
	$dist = (Aws cloudfront create-distribution --distribution-config (JsonFile $config)).Distribution

	# Let this distribution, and nothing else, read the bucket
	$policy = @{
		Version = "2012-10-17"
		Statement = @(@{
			Sid = "CloudFrontRead"; Effect = "Allow"
			Principal = @{ Service = "cloudfront.amazonaws.com" }
			Action = "s3:GetObject"
			Resource = "arn:aws:s3:::$bucket/*"
			Condition = @{ StringEquals = @{ "AWS:SourceArn" = $dist.ARN } }
		})
	}
	Aws s3api put-bucket-policy --bucket $bucket --policy (JsonFile $policy) | Out-Null
	$created = $true
}

# 3. Upload the site: the page, its icons and public/ (not app/, tools, or personal exports)
$sync = @("s3", "sync", ".", "s3://$bucket", "--delete", "--exclude", "*",
	"--include", "index.html", "--include", "robots.txt", "--include", "site.webmanifest",
	"--include", "browserconfig.xml", "--include", "favicon*", "--include", "safari-pinned-tab.svg",
	"--include", "android-chrome-*.png", "--include", "apple-touch-icon.png", "--include", "mstile-150x150.png",
	"--include", "public/*", "--exclude", "*/desktop.ini", "--exclude", "*.lnk", "--exclude", "*/Thumbs.db",
	"--exclude", "*gear-collection-export*", "--exclude", "Pedal Playground Workspace*", "--only-show-errors")
Write-Host "Uploading (the first time is about 3 GB of pedal images, so it takes a while)"
Aws @sync
# The page itself is always checked for changes (scripts and styles are versioned with ?v=N)
Aws s3 cp index.html "s3://$bucket/index.html" --cache-control "no-cache" --content-type "text/html; charset=utf-8" --only-show-errors

# 4. Clear CloudFront's cache after an update
if (-not $created) {
	Aws cloudfront create-invalidation --distribution-id $dist.Id --paths "/*" | Out-Null
}

Write-Host ""
Write-Host "Site: https://$($dist.DomainName)/"
if ($created) { Write-Host "(New distribution: it can take 5-15 minutes before the link works.)" }
