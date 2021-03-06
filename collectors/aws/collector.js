/*********************
 Collector - The collector will query AWS APIs for the information required
 to run the CloudSploit scans. This data will be returned in the callback
 as a JSON object.

 Arguments:
 - AWSConfig: If using an access key/secret, pass in the config object. Pass null if not.
 - settings: custom settings for the scan. Properties:
 - skip_regions: (Optional) List of regions to skip
 - api_calls: (Optional) If provided, will only query these APIs.
 - Example:
 {
     "skip_regions": ["us-east-2", "eu-west-1"],
     "api_calls": ["EC2:describeInstances", "S3:listBuckets"]
 }
 - callback: Function to call when the collection is complete
 *********************/

var AWS = require('aws-sdk');
var async = require('async');
var helpers = require(__dirname + '/../../helpers/aws');
var collectors = require(__dirname + '/../../collectors/aws');

var globalServices = [
    'S3',
    'IAM',
    'CloudFront',
    'Route53',
    'Route53Domains',
    'WAFRegional'
];

var calls = {
    ACM: {
        listCertificates: {
            property: 'CertificateSummaryList',
            paginate: 'NextToken'
        }
    },
    Athena: {
        listWorkGroups: {
            property: 'WorkGroups',
            paginate: 'NextToken',
            params: {
                MaxResults: 50
            }
        }
    },
    AutoScaling: {
        describeAutoScalingGroups: {
            property: 'AutoScalingGroups',
            paginate: 'NextToken',
            params: {
                MaxRecords: 100
            }
        }
    },
    CloudFront: {
        // TODO: Pagination is using an older format
        listDistributions: {
            property: 'DistributionList',
            secondProperty: 'Items'
        }
    },
    CloudTrail: {
        describeTrails: {
            property: 'trailList'
        }
    },
    CloudWatchLogs: {
        describeLogGroups: {
            property: 'logGroups',
            paginate: 'nextToken',
            params: {
                limit: 50
            }
        },
        describeMetricFilters: {
            property: 'metricFilters',
            paginate: 'nextToken',
            params: {
                limit: 50 // The max available
            }
        }
    },
    ConfigService: {
        describeConfigurationRecorders: {
            property: 'ConfigurationRecorders'
        },
        describeConfigurationRecorderStatus: {
            property: 'ConfigurationRecordersStatus'
        }
    },
    DirectConnect: {
        describeDirectConnectGateways: {
            property: 'directConnectGateways',
            paginate: 'nextToken'
        }
    },
    DirectoryService: {
        describeDirectories: {
            property: 'DirectoryDescriptions',
            paginate: 'NextToken'
        }
    },
    DynamoDB: {
        // TODO: DynamoDB pagination uses a table reference via "ExclusiveStartTableName"
        listTables: {
            property: 'TableNames'
        }
    },
    EC2: {
        describeAccountAttributes: {
            property: 'AccountAttributes'
        },
        describeSubnets: {
            property: 'Subnets',
            paginate: 'NextToken'
        },
        describeAddresses: {
            property: 'Addresses'
        },
        describeVolumes: {
            property: 'Volumes'
        },
        describeSnapshots: {
            // This call must be overridden because the
            // default call retrieves every snapshot
            // available, including public ones
            override: true
        },
        describeInstances: {
            property: 'Reservations',
            paginate: 'NextToken',
            params: {
                MaxResults: 1000,
                Filters: [
                    {
                        Name: 'instance-state-name',
                        Values: [
                            'pending',
                            'running',
                            'shutting-down',
                            'stopping',
                            'stopped'
                        ]
                    }
                ]
            }
        },
        describeSecurityGroups: {
            property: 'SecurityGroups'
        },
        describeVpcs: {
            property: 'Vpcs',
            paginate: 'NextToken'
        },
        describeFlowLogs: {
            // TODO: override bc flowlogs are not available in all regions?
            property: 'FlowLogs'
        },
        describeImages: {
            property: 'Images',
            params: {
                Owners: [
                    'self'
                ],
                Filters: [
                    {
                        Name: 'state',
                        Values: [
                            'available'
                        ]
                    }
                ]
            }
        },
        describeNatGateways: {
            property: 'NatGateways',
            paginate: 'NextToken',
            params: {
                Filter: [
                    {
                        Name: 'state',
                        Values: [
                            'available'
                        ]
                    }
                ]
            }
        },
        describeVpcPeeringConnections: {
            property: 'VpcPeeringConnections',
            paginate: 'NextToken',
            params: {
                Filters: [
                    {
                        Name: 'status-code',
                        Values: [
                            'pending-acceptance',
                            'provisioning',
                            'active'
                        ]
                    }
                ]
            }
        },
        describeVpnGateways: {
            property: 'VpnGateways',
            params: {
                Filters: [
                    {
                        Name: 'state',
                        Values: [
                            'available'
                        ]
                    }
                ]
            }
        },
        describeRouteTables: {
            property: 'RouteTables',
            paginate: 'NextToken'
        }
    },
    ECR: {
        describeRepositories: {
            property: 'repositories',
            paginate: 'nextToken',
            params: {
                maxResults: 1000
            }
        }
    },
    EFS: {
        describeFileSystems: {
            property: 'FileSystems',
            paginate: 'NextMarker',
            paginateReqProp: 'Marker'
        }
    },
    EKS: {
        listClusters: {
            property: 'clusters',
            paginate: 'nextToken'
        }
    },
    ElasticTranscoder: {
        // TODO: Pagination via NextPageToken and PageToken
        listPipelines: {
            property: 'Pipelines',
            paginate: 'NextPageToken',
            paginateReqProp: 'PageToken'
        }
    },
    ELB: {
        describeLoadBalancers: {
            property: 'LoadBalancerDescriptions',
            paginate: 'NextMarker',
            paginateReqProp: 'Marker'
        }
    },
    ELBv2: {
        describeLoadBalancers: {
            property: 'LoadBalancers',
            paginate: 'NextMarker',
            paginateReqProp: 'Marker'
        },
        describeTargetGroups: {
            property: 'TargetGroups',
            paginate: 'NextMarker',
            paginateReqProp: 'Marker'
        }
    },
    ES: {
        listDomainNames: {
            property: 'DomainNames'
        }
    },
    IAM: {
        listServerCertificates: {
            property: 'ServerCertificateMetadataList',
            paginate: 'Marker'
        },
        listGroups: {
            property: 'Groups',
            paginate: 'Marker'
        },
        listUsers: {
            property: 'Users',
            paginate: 'Marker'
        },
        listRoles: {
            property: 'Roles',
            paginate: 'Marker'
        },
        listVirtualMFADevices: {
            property: 'VirtualMFADevices',
            paginate: 'Marker'
        },
        getAccountPasswordPolicy: {
            property: 'PasswordPolicy'
        },
        getAccountSummary: {
            property: 'SummaryMap'
        },
        generateCredentialReport: {
            override: true
        }
    },
    Kinesis: {
        listStreams: {
            property: 'StreamNames'
        }
    },
    Firehose: {
        listDeliveryStreams: {
            property: 'DeliveryStreamNames'
        }
    },
    KMS: {
        listKeys: {
            property: 'Keys',
            paginate: 'NextMarker',
            paginateReqProp: 'Marker',
            params: {
                Limit: 1000
            }
        },
    },
    Lambda: {
        listFunctions: {
            property: 'Functions',
            paginate: 'NextMarker',
            paginateReqProp: 'Marker'
        }
    },
    RDS: {
        describeDBInstances: {
            property: 'DBInstances',
            paginate: 'Marker'
        },
        describeDBClusters: {
            property: 'DBClusters',
            paginate: 'Marker'
        },
        describeDBEngineVersions: {
            property: 'DBEngineVersions',
            paginate: 'Marker',
            default: true
        },
        describeDBSnapshots: {
            property: 'DBSnapshots',
            paginate: 'Marker'
        }
    },
    Redshift: {
        describeClusters: {
            property: 'Clusters',
            paginate: 'Marker'
        }
    },
    Route53Domains: {
        listDomains: {
            property: 'Domains',
            paginate: 'NextPageMarker',
            paginateReqProp: 'Marker'
        }
    },
    S3: {
        listBuckets: {
            property: 'Buckets'
        }
    },
    SageMaker: {
        listNotebookInstances: {
            property: 'NotebookInstances',
            paginate: 'NextToken'
        }
    },
    SES: {
        listIdentities: {
            property: 'Identities',
            paginate: 'NextToken',
            params: {
                IdentityType: 'Domain', // TODO: maybe don't filter these?
                MaxItems: 1000
            },
            rateLimit: 1000 // ms to rate limit between regions
        },
        describeActiveReceiptRuleSet: {
            property: 'Rules'
        }
    },
    Shield: {
        describeSubscription: {
            property: 'Subscription'
        },
        describeEmergencyContactSettings: {
            property: 'EmergencyContactList'
        },
        listProtections: {
            property: 'Protections'
        }
    },
    SNS: {
        listTopics: {
            property: 'Topics',
            paginate: 'NextToken'
        }
    },
    SQS: {
        listQueues: {
            property: 'QueueUrls'
        }
    },
    SSM: {
        describeParameters: {
            property: 'Parameters',
            params: {
                MaxResults: 50
            },
            paginate: 'NextToken'
        }
    },
    STS: {
        getCallerIdentity: {
            property: 'Account'
        }
    },
    Transfer: {
        listServers: {
            property: 'Servers',
            paginate: 'NextToken',
            params: {
                MaxResults: 1000
            }
        }
    },
    WAFRegional: {
        listWebACLs: {
            property: 'WebACLs',
            paginate: 'NextMarker'
        }
    },
    WorkSpaces: {
        describeWorkspaces: {
            property: 'Workspaces',
            paginate: 'NextToken'
        }
    }
};

var postcalls = [
    {
        ACM: {
            describeCertificate: {
                reliesOnService: 'acm',
                reliesOnCall: 'listCertificates',
                filterKey: 'CertificateArn',
                filterValue: 'CertificateArn'
            }
        },
        Athena: {
            getWorkGroup: {
                reliesOnService: 'athena',
                reliesOnCall: 'listWorkGroups',
                filterKey: 'WorkGroup',
                filterValue: 'Name'
            }
        },
        CloudFront: {
            getDistribution: {
                reliesOnService: 'cloudfront',
                reliesOnCall: 'listDistributions',
                override: true
            }
        },
        CloudTrail: {
            getTrailStatus: {
                reliesOnService: 'cloudtrail',
                reliesOnCall: 'describeTrails',
                filterKey: 'Name',
                filterValue: 'TrailARN'
            },
            listTags: {
                reliesOnService: 'cloudtrail',
                reliesOnCall: 'describeTrails',
                override: true
            }
        },
        DynamoDB: {
            describeTable: {
                reliesOnService: 'dynamodb',
                reliesOnCall: 'listTables',
                override: true
            }
        },
        ES: {
            describeElasticsearchDomain: {
                reliesOnService: 'es',
                reliesOnCall: 'listDomainNames',
                filterKey: 'DomainName',
                filterValue: 'DomainName'
            }
        },
        S3: {
            getBucketLogging: {
                deleteRegion: true,
                signatureVersion: 'v4',
                override: true
            },
            getBucketVersioning: {
                deleteRegion: true,
                signatureVersion: 'v4',
                override: true
            },
            getBucketAcl: {
                deleteRegion: true,
                signatureVersion: 'v4',
                override: true
            },
            getBucketPolicy: {
                deleteRegion: true,
                signatureVersion: 'v4',
                override: true
            },
            getBucketEncryption: {
                deleteRegion: true,
                signatureVersion: 'v4',
                override: true
            },
            getBucketTagging: {
                deleteRegion: true,
                signatureVersion: 'v4',
                override: true
            }
        },
        EC2: {
            describeSubnets: {
                reliesOnService: 'ec2',
                reliesOnCall: 'describeVpcs',
                override: true
            }
        },
        ECR: {
            getRepositoryPolicy: {
                reliesOnService: 'ecr',
                reliesOnCall: 'describeRepositories',
                filterKey: 'repositoryName',
                filterValue: 'repositoryName'
            }
        },
        EKS: {
            describeCluster: {
                reliesOnService: 'eks',
                reliesOnCall: 'listClusters',
                override: true
            }
        },
        ELB: {
            describeLoadBalancerPolicies: {
                reliesOnService: 'elb',
                reliesOnCall: 'describeLoadBalancers',
                override: true
            },
            describeLoadBalancerAttributes: {
                reliesOnService: 'elb',
                reliesOnCall: 'describeLoadBalancers',
                override: true
            }
        },
        ELBv2: {
            describeTargetHealth: {
                reliesOnService: 'elbv2',
                reliesOnCall: 'describeTargetGroups',
                filterKey: 'TargetGroupArn',
                filterValue: 'TargetGroupArn'
            }
        },
        IAM: {
            getGroup: {
                reliesOnService: 'iam',
                reliesOnCall: 'listGroups',
                filterKey: 'GroupName',
                filterValue: 'GroupName'
            },
            listAttachedUserPolicies: {
                reliesOnService: 'iam',
                reliesOnCall: 'listUsers',
                filterKey: 'UserName',
                filterValue: 'UserName'
            },
            listAttachedGroupPolicies: {
                reliesOnService: 'iam',
                reliesOnCall: 'listGroups',
                filterKey: 'GroupName',
                filterValue: 'GroupName'
            },
            listAttachedRolePolicies: {
                reliesOnService: 'iam',
                reliesOnCall: 'listRoles',
                filterKey: 'RoleName',
                filterValue: 'RoleName'
            },
            listUserPolicies: {
                reliesOnService: 'iam',
                reliesOnCall: 'listUsers',
                filterKey: 'UserName',
                filterValue: 'UserName'
            },
            listGroupPolicies: {
                reliesOnService: 'iam',
                reliesOnCall: 'listGroups',
                filterKey: 'GroupName',
                filterValue: 'GroupName'
            },
            listRolePolicies: {
                reliesOnService: 'iam',
                reliesOnCall: 'listRoles',
                filterKey: 'RoleName',
                filterValue: 'RoleName'
            },
            listSSHPublicKeys: {
                reliesOnService: 'iam',
                reliesOnCall: 'listUsers',
                filterKey: 'UserName',
                filterValue: 'UserName'
            },
            listMFADevices: {
                reliesOnService: 'iam',
                reliesOnCall: 'listUsers',
                filterKey: 'UserName',
                filterValue: 'UserName'
            },
            listGroupsForUser: {
                reliesOnService: 'iam',
                reliesOnCall: 'listUsers',
                filterKey: 'UserName',
                filterValue: 'UserName',
                rateLimit: 100
            }
        },
        Kinesis: {
            describeStream: {
                reliesOnService: 'kinesis',
                reliesOnCall: 'listStreams',
                override: true
            }
        },
        Firehose: {
            describeDeliveryStream: {
                reliesOnService: 'firehose',
                reliesOnCall: 'listDeliveryStreams',
                override: true
            }
        },
        KMS: {
            describeKey: {
                reliesOnService: 'kms',
                reliesOnCall: 'listKeys',
                filterKey: 'KeyId',
                filterValue: 'KeyId'
            },
            getKeyRotationStatus: {
                reliesOnService: 'kms',
                reliesOnCall: 'listKeys',
                filterKey: 'KeyId',
                filterValue: 'KeyId'
            },
            getKeyPolicy: {
                reliesOnService: 'kms',
                reliesOnCall: 'listKeys',
                override: true
            }
        },
        Lambda: {
            getPolicy: {
                reliesOnService: 'lambda',
                reliesOnCall: 'listFunctions',
                filterKey: 'FunctionName',
                filterValue: 'FunctionName'
            },
            listTags: {
                reliesOnService: 'lambda',
                reliesOnCall: 'listFunctions',
                filterKey: 'Resource',
                filterValue: 'FunctionArn'
            }
        },
        SageMaker: {
            describeNotebookInstance: {
                reliesOnService: 'sagemaker',
                reliesOnCall: 'listNotebookInstances',
                filterKey: 'NotebookInstanceName',
                filterValue: 'NotebookInstanceName'
            }
        },
        SES: {
            getIdentityDkimAttributes: {
                reliesOnService: 'ses',
                reliesOnCall: 'listIdentities',
                override: true,
                rateLimit: 1000
            }
        },
        SNS: {
            getTopicAttributes: {
                reliesOnService: 'sns',
                reliesOnCall: 'listTopics',
                filterKey: 'TopicArn',
                filterValue: 'TopicArn'
            }
        },
        SQS: {
            getQueueAttributes: {
                reliesOnService: 'sqs',
                reliesOnCall: 'listQueues',
                override: true
            }
        },
        WAFRegional: {
            listResourcesForWebACL: {
                reliesOnService: 'wafregional',
                reliesOnCall: 'listWebACLs',
                filterKey: 'WebACLId',
                filterValue: 'WebACLId',
                checkMultiple: ["APPLICATION_LOAD_BALANCER", "API_GATEWAY"],
                checkMultipleKey: 'ResourceType'
            }
        }
    },
    {
        IAM: {
            getUserPolicy: {
                reliesOnService: 'iam',
                reliesOnCall: 'listUsers',
                override: true
            },
            getGroupPolicy: {
                reliesOnService: 'iam',
                reliesOnCall: 'listGroups',
                override: true
            },
            getRolePolicy: {
                reliesOnService: 'iam',
                reliesOnCall: 'listRoles',
                override: true
            }
        }
    }
];

// Loop through all of the top-level collectors for each service
var collect = function (AWSConfig, settings, callback) {
    AWSConfig.maxRetries = 8;
    AWSConfig.retryDelayOptions = {base: 100};

    var regions = helpers.regions(settings);

    var collection = {};
    var myDate = new Date();
    var callsTime = myDate.getTime();
    var debugTime = settings.debugTime;

    async.eachOfLimit(calls, 10, function (call, service, serviceCb) {
        var serviceLower = service.toLowerCase();

        if (!collection[serviceLower]) collection[serviceLower] = {};

        // Loop through each of the service's functions
        async.eachOfLimit(call, 10, function (callObj, callKey, callCb) {
            if (settings.api_calls && settings.api_calls.indexOf(service + ':' + callKey) === -1) return callCb();
            if (!collection[serviceLower][callKey]) collection[serviceLower][callKey] = {};

            var callRegions;

            if (callObj.default) {
                callRegions = regions.default;
            }  else {
                callRegions = regions[serviceLower];
            }

            async.eachLimit(callRegions, helpers.MAX_REGIONS_AT_A_TIME, function (region, regionCb) {
                if (settings.skip_regions &&
                    settings.skip_regions.indexOf(region) > -1 &&
                    globalServices.indexOf(service) === -1) return regionCb();
                if (!collection[serviceLower][callKey][region]) collection[serviceLower][callKey][region] = {};

                var LocalAWSConfig = JSON.parse(JSON.stringify(AWSConfig));
                LocalAWSConfig.region = region;

                if (callObj.override) {
                    collectors[serviceLower][callKey](LocalAWSConfig, collection, function () {
                        if (callObj.rateLimit) {
                            setTimeout(function () {
                                regionCb();
                            }, callObj.rateLimit);
                        } else {
                            regionCb();
                        }
                    });
                } else {
                    var executor = new AWS[service](LocalAWSConfig);
                    var paginating = false;
                    var executorCb = function (err, data) {
                        if (debugTime) {
                            var innerDate = new Date();
                            var callInnerTime = innerDate.getTime();
                            var thisTime = callInnerTime - callsTime;

                            console.log(`${callKey} - ${thisTime}`);
                        }

                        if (err) collection[serviceLower][callKey][region].err = err;

                        if (!data) return regionCb();
                        if (callObj.property && !data[callObj.property]) return regionCb();
                        if (callObj.secondProperty && !data[callObj.secondProperty]) return regionCb();

                        var dataToAdd = callObj.secondProperty ? data[callObj.property][callObj.secondProperty] : data[callObj.property];

                        if (paginating) {
                            collection[serviceLower][callKey][region].data = collection[serviceLower][callKey][region].data.concat(dataToAdd);
                        } else {
                            collection[serviceLower][callKey][region].data = dataToAdd;
                        }

                        // If a "paginate" property is set, e.g. NextToken
                        var nextToken = callObj.paginate;
                        if (settings.paginate && nextToken && data[nextToken]) {
                            paginating = true;
                            var paginateProp = callObj.paginateReqProp ? callObj.paginateReqProp : nextToken;
                            return execute([paginateProp, data[nextToken]]);
                        }

                        if (callObj.rateLimit) {
                            setTimeout(function () {
                                regionCb();
                            }, callObj.rateLimit);
                        } else {
                            regionCb();
                        }
                    };

                    function execute(nextTokens) {

                        // Each region needs its own local copy of callObj.params
                        // so that the injection of the NextToken doesn't break other calls
                        var localParams = JSON.parse(JSON.stringify(callObj.params || {}));
                        if (nextTokens) localParams[nextTokens[0]] = nextTokens[1];

                        if (callObj.params || nextTokens) {
                            executor[callKey](localParams, executorCb);
                        } else {
                            executor[callKey](executorCb);
                        }
                    }

                    execute();
                }
            }, function () {
                callCb();
            });
        }, function () {
            serviceCb();
        });
    }, function () {
        // Now loop through the follow up calls
        async.eachSeries(postcalls, function (postcallObj, postcallCb) {
            async.eachOfLimit(postcallObj, 10, function (serviceObj, service, serviceCb) {
                var serviceLower = service.toLowerCase();
                if (!collection[serviceLower]) collection[serviceLower] = {};

                async.eachOfLimit(serviceObj, 1, function (callObj, callKey, callCb) {
                    if (settings.api_calls && settings.api_calls.indexOf(service + ':' + callKey) === -1) return callCb();
                    if (!collection[serviceLower][callKey]) collection[serviceLower][callKey] = {};

                    async.eachLimit(regions[serviceLower], helpers.MAX_REGIONS_AT_A_TIME, function (region, regionCb) {
                        if (settings.skip_regions &&
                            settings.skip_regions.indexOf(region) > -1 &&
                            globalServices.indexOf(service) === -1) return regionCb();
                        if (!collection[serviceLower][callKey][region]) collection[serviceLower][callKey][region] = {};

                        // Ensure pre-requisites are met
                        if (callObj.reliesOnService && !collection[callObj.reliesOnService]) return regionCb();

                        if (callObj.reliesOnCall &&
                            (!collection[callObj.reliesOnService] ||
                            !collection[callObj.reliesOnService][callObj.reliesOnCall] ||
                            !collection[callObj.reliesOnService][callObj.reliesOnCall][region] ||
                            !collection[callObj.reliesOnService][callObj.reliesOnCall][region].data ||
                            !collection[callObj.reliesOnService][callObj.reliesOnCall][region].data.length)) return regionCb();

                        var LocalAWSConfig = JSON.parse(JSON.stringify(AWSConfig));
                        if (callObj.deleteRegion) {
                            //delete LocalAWSConfig.region;
                            LocalAWSConfig.region = settings.govcloud ? 'us-gov-west-1' : settings.china ? 'cn-north-1' : 'us-east-1';
                        } else {
                            LocalAWSConfig.region = region;
                        }
                        if (callObj.signatureVersion) LocalAWSConfig.signatureVersion = callObj.signatureVersion;

                        if (callObj.override) {
                            collectors[serviceLower][callKey](LocalAWSConfig, collection, function () {
                                if (callObj.rateLimit) {
                                    setTimeout(function () {
                                        regionCb();
                                    }, callObj.rateLimit);
                                } else {
                                    regionCb();
                                }
                            });
                        } else {
                            var executor = new AWS[service](LocalAWSConfig);

                            if (!collection[callObj.reliesOnService][callObj.reliesOnCall][LocalAWSConfig.region] ||
                                !collection[callObj.reliesOnService][callObj.reliesOnCall][LocalAWSConfig.region].data) {
                                return regionCb();
                            }

                            async.eachLimit(collection[callObj.reliesOnService][callObj.reliesOnCall][LocalAWSConfig.region].data, 10, function (dep, depCb) {
                                if (callObj.checkMultiple) {
                                    async.each(callObj.checkMultiple, function(thisCheck, tcCb){
                                        collection[serviceLower][callKey][LocalAWSConfig.region][dep[callObj.filterValue]] = {};

                                        var filter = {};
                                        filter[callObj.filterKey] = dep[callObj.filterValue];
                                        filter[callObj.checkMultipleKey] = thisCheck;

                                        executor[callKey](filter, function (err, data) {
                                            if (debugTime) {
                                                var innerDate = new Date();
                                                var callInnerTime = innerDate.getTime();
                                                var thisTime = callInnerTime - callsTime;

                                                console.log(`${callKey} - ${thisTime}`);
                                            }
                                            if (err) {
                                                collection[serviceLower][callKey][LocalAWSConfig.region][dep[callObj.filterValue]].err = err;
                                            }
                                            if (data) {
                                                if (!collection[serviceLower][callKey][LocalAWSConfig.region][dep[callObj.filterValue]].data) {
                                                    collection[serviceLower][callKey][LocalAWSConfig.region][dep[callObj.filterValue]].data = data;
                                                }
                                            }
                                            tcCb();
                                        });
                                    }, function() {
                                        depCb();
                                    });
                                } else {
                                    collection[serviceLower][callKey][LocalAWSConfig.region][dep[callObj.filterValue]] = {};

                                    var filter = {};
                                    filter[callObj.filterKey] = dep[callObj.filterValue];
                                    executor[callKey](filter, function (err, data) {
                                        if (debugTime) {
                                            var innerDate = new Date();
                                            var callInnerTime = innerDate.getTime();
                                            var thisTime = callInnerTime - callsTime;

                                            console.log(`${callKey} - ${thisTime}`);
                                        }
                                        if (err) {
                                            collection[serviceLower][callKey][LocalAWSConfig.region][dep[callObj.filterValue]].err = err;
                                            depCb();
                                        } else {
                                            collection[serviceLower][callKey][LocalAWSConfig.region][dep[callObj.filterValue]].data = data;
                                            depCb();
                                        }
                                    });
                                }
                            }, function () {
                                if (callObj.rateLimit) {
                                    setTimeout(function () {
                                        regionCb();
                                    }, callObj.rateLimit);
                                } else {
                                    regionCb();
                                }
                            });
                        }
                    }, function () {
                        callCb();
                    });
                }, function () {
                    serviceCb();
                });
            }, function () {
                postcallCb();
            });
        }, function () {
            //console.log(JSON.stringify(collection, null, 2));
            callback(null, collection);
        });
    });
};

module.exports = collect;
